// src/utils.ts
// utility functions for timestamps, validation & command execution

import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import os from "node:os";
import { MAX_BUFFER } from "./constants.js";

// convert unix timestamp (milliseconds) to ISO 8601 string
export function toISOTimestamp(unixMs: number): string {
  return new Date(unixMs).toISOString();
}

// extract message from unknown error
export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// parse --since argument (number of days or ISO date string)
export function parseSince(value: string): Date {
  const days = parseInt(value, 10);
  if (!isNaN(days) && days.toString() === value.trim()) {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    throw new Error(
      `Invalid --since value: "${value}". Use a number of days or an ISO date.`
    );
  }
  return date;
}

// parse --since value or exit w/ error
export function parseSinceOrExit(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  try {
    return parseSince(value);
  } catch (err) {
    console.error(`Error: ${getErrorMessage(err)}`);
    process.exit(1);
  }
}

// check if file exists at given path
export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// create deduplication key for message
export function dedupeKey(messageId: string, timestamp: number): string {
  return `${messageId}:${timestamp}`;
}

// log message if verbose mode is enabled
export function verboseLog(
  verbose: boolean,
  message: string,
  ...args: unknown[]
): void {
  if (verbose) {
    console.log(message, ...args);
  }
}

// log warning message w/ [WARN] prefix
export function warn(message: string, ...args: unknown[]): void {
  console.warn(`[WARN] ${message}`, ...args);
}

// format count w/ singular/plural noun
export function pluralize(count: number, singular: string, plural?: string): string {
  const noun = count === 1 ? singular : (plural ?? `${singular}s`);
  return `${count} ${noun}`;
}

// format number w/ locale-specific thousand separators
export function formatNumber(num: number): string {
  return num.toLocaleString("en-US");
}

// format number as USD currency
export function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

// determine optimal concurrency for parallel I/O operations
// based on system resources (CPU count)
export function getOptimalConcurrency(override?: number): number {
  // allow explicit override via CLI flag
  if (override !== undefined && override > 0) {
    return override;
  }
  const cpus = os.cpus().length;
  // I/O-bound subprocess work benefits from higher concurrency
  // Min 8 for responsiveness, max 32 to avoid overwhelming system
  return Math.max(8, Math.min(32, cpus * 2));
}

export interface ExecError extends Error {
  code?: string | number;
  stdout?: string;
  stderr?: string;
  killed?: boolean;
  signal?: string;
}

// type guard for exec errors from child_process
export function isExecError(err: unknown): err is ExecError {
  if (!(err instanceof Error)) return false;
  const e = err as unknown as Record<string, unknown>;
  return (
    (typeof e.code === "string" || typeof e.code === "number" || e.code === undefined) &&
    (typeof e.stdout === "string" || e.stdout === undefined) &&
    (typeof e.stderr === "string" || e.stderr === undefined)
  );
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// escape argument for shell (single-quote with escaping)
function shellEscape(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

// execute command & return stdout using spawn (more efficient than exec)
export async function execCommand(
  command: string,
  args: string[],
  cwd?: string,
  outputFile?: string
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    let child;

    // when outputFile is specified, use shell redirection to avoid pipe buffering issues
    // some programs (like opencode) don't flush stdout properly when piped
    if (outputFile) {
      const escapedArgs = args.map(shellEscape).join(" ");
      const escapedOutput = shellEscape(outputFile);
      const shellCmd = `${command} ${escapedArgs} > ${escapedOutput}`;
      child = spawn("sh", ["-c", shellCmd], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } else {
      child = spawn(command, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
    }

    let stdout = "";
    let stderr = "";
    let stdoutSize = 0;
    let stderrSize = 0;

    child.stdout?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stdoutSize += chunk.length;
      if (stdoutSize <= MAX_BUFFER) {
        stdout += chunk;
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stderrSize += chunk.length;
      if (stderrSize <= MAX_BUFFER) {
        stderr += chunk;
      }
    });

    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });

    child.on("error", (err) => {
      if (err.message.includes("ENOENT") || err.message.includes("spawn")) {
        reject(
          new Error(
            `Failed to execute ${command}: command not found. Is OpenCode installed?`
          )
        );
      } else {
        reject(new Error(`Failed to execute ${command}: ${err.message}`));
      }
    });
  });
}
