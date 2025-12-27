// src/report-runner.ts
// report runner utilities - handles execution of ccusage & combined reports

import { exec, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  loadCcusageJson,
  mergeDailyReports,
  renderMergedTable,
  runCcusageJson,
} from "./ccusage-merge.js";
import { CLAUDE_CONFIG_PATHS, OPENCODE_CONFIG_DIR } from "./constants.js";
import { createExportOptions, printSummary, runExport } from "./exporter.js";
import type { CcusageDailyOutput } from "./types.js";
import { getErrorMessage, pluralize, verboseLog } from "./utils.js";

const execAsync = promisify(exec);

// re-export for consumers
export { OPENCODE_CONFIG_DIR };

// find existing Claude Code data directories
export function findClaudeConfigDirs(): string[] {
  const existing: string[] = [];
  for (const dir of CLAUDE_CONFIG_PATHS) {
    const projectsDir = path.join(dir, "projects");
    if (existsSync(projectsDir)) {
      existing.push(dir);
    }
  }
  return existing;
}

// check if ccusage is available via npx
export async function checkCcusageAvailable(): Promise<boolean> {
  try {
    await execAsync("npx ccusage --version", { timeout: 30000 });
    return true;
  } catch {
    return false;
  }
}

// run ccusage w/ specified config directories
export function runCcusage(
  configDir: string | undefined,
  args: string[],
  verbose: boolean
): Promise<number> {
  return new Promise((resolve) => {
    // build command - only set CLAUDE_CONFIG_DIR if configDir is provided
    const envPrefix = configDir ? `CLAUDE_CONFIG_DIR="${configDir}" ` : "";
    const command = `${envPrefix}npx ccusage ${args.join(" ")}`;

    verboseLog(verbose, `Running: ${command}`);

    const child = spawn("sh", ["-c", command], { stdio: "inherit" });

    child.on("close", (code) => {
      resolve(code ?? 0);
    });

    child.on("error", (err) => {
      console.error(`Failed to run ccusage: ${err.message}`);
      resolve(1);
    });
  });
}

// get terminal width for responsive table rendering
function getTerminalWidth(): number {
  return process.stdout.columns || 120;
}

export interface CombinedReportOptions {
  combineArg: string | boolean;
  ccusageArgs: string[];
  skipExport: boolean;
  since: Date | undefined;
  verbose: boolean;
  outputJson: boolean;
}

// * run combined report mode - runs ccusage separately for Claude & OpenCode, then merges
export async function runCombinedReport(options: CombinedReportOptions): Promise<number> {
  const { combineArg, ccusageArgs, skipExport, since, verbose, outputJson } = options;
  const reports: { data: CcusageDailyOutput; source: string }[] = [];

  // export OpenCode sessions (unless skipped)
  if (!skipExport) {
    verboseLog(verbose, "Exporting OpenCode sessions...\n");

    const exportOptions = createExportOptions(OPENCODE_CONFIG_DIR, {
      since,
      verbose,
    });

    try {
      const stats = await runExport(exportOptions);

      if (verbose) {
        printSummary(stats);
        console.log("");
      } else if (stats.sessionsExported > 0) {
        console.log(`Exported ${pluralize(stats.sessionsExported, "session")}\n`);
      }
    } catch (err) {
      console.error(`Export error: ${getErrorMessage(err)}`);
      if (!verbose) {
        console.error("Use --verbose for more details.\n");
      }
      // continue even if export fails
    }
  }

  // get Claude Code usage
  if (typeof combineArg === "string") {
    // load from file
    verboseLog(verbose, `Loading Claude Code usage from file: ${combineArg}\n`);
    const claudeData = await loadCcusageJson(combineArg);
    if (claudeData) {
      reports.push({ data: claudeData, source: "Claude Code" });
    } else {
      console.error(`Failed to load ccusage JSON from: ${combineArg}`);
      return 1;
    }
  } else {
    // run ccusage for Claude Code - let ccusage auto-detect directories
    verboseLog(verbose, "Getting Claude Code usage...\n");
    const claudeData = await runCcusageJson(undefined, ccusageArgs, verbose);
    if (claudeData) {
      reports.push({ data: claudeData, source: "Claude Code" });
    } else {
      verboseLog(verbose, "No Claude Code usage data found or ccusage failed.\n");
    }
  }

  // get OpenCode usage
  verboseLog(verbose, "Getting OpenCode usage...\n");
  const opencodeData = await runCcusageJson(OPENCODE_CONFIG_DIR, ccusageArgs, verbose);
  if (opencodeData) {
    reports.push({ data: opencodeData, source: "OpenCode" });
  } else {
    verboseLog(verbose, "No OpenCode usage data found or ccusage failed.\n");
  }

  // merge & display
  if (reports.length === 0) {
    console.log("No usage data found from any source.");
    return 1;
  }

  const merged = mergeDailyReports(reports);

  if (outputJson) {
    console.log(JSON.stringify(merged, null, 2));
  } else {
    const terminalWidth = getTerminalWidth();
    const useCompact = terminalWidth < 100;
    const table = renderMergedTable(merged, useCompact);
    console.log(table);
  }

  return 0;
}
