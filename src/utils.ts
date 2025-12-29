// src/utils.ts
// utility functions for timestamps, validation & command execution

import { exec } from "node:child_process";
import { access, constants } from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";
import { MAX_BUFFER } from "./constants.js";

const execAsync = promisify(exec);

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
export function getOptimalConcurrency(): number {
  const cpus = os.cpus().length;
  // For I/O-bound work (CLI subprocesses), use ~50% of CPUs
  // Min 4 for responsiveness, max 16 to avoid overwhelming system
  return Math.max(4, Math.min(16, Math.floor(cpus * 0.5)));
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

// execute command & return stdout
export async function execCommand(
  command: string,
  args: string[],
  cwd?: string,
  outputFile?: string
): Promise<ExecResult> {
  // escape arguments for shell
  const escapedArgs = args.map((arg) => `'${arg.replace(/'/g, "'\\''")}'`);
  let fullCommand = `${command} ${escapedArgs.join(" ")}`;

  // redirect stdout to file if specified
  if (outputFile) {
    fullCommand += ` > '${outputFile.replace(/'/g, "'\\''")}'`;
  }

  try {
    const { stdout, stderr } = await execAsync(fullCommand, {
      maxBuffer: MAX_BUFFER,
      encoding: "utf-8",
      cwd,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    // use type guard for proper error typing
    if (!isExecError(err)) {
      throw new Error(`Failed to execute ${command}: ${getErrorMessage(err)}`);
    }

    if (err.message?.includes("command not found") || err.message?.includes("ENOENT")) {
      throw new Error(
        `Failed to execute ${command}: command not found. Is OpenCode installed?`
      );
    }

    // if it's exit code error, return output anyway
    if (typeof err.code === "number" || err.stdout !== undefined) {
      return {
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
        exitCode: typeof err.code === "number" ? err.code : 1,
      };
    }

    throw new Error(`Failed to execute ${command}: ${err.message}`);
  }
}
