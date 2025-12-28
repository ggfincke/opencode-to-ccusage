// src/exporter.ts
// main export orchestration & statistics

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import cliProgress from "cli-progress";
import { convertSession, toJsonl } from "./converter.js";
import {
  checkOpenCodeAvailable,
  exportSessionWithRetry,
  getStorageDir,
  listSessions,
} from "./session.js";
import type { ExportOptions, ExportStats, GroupBy, SessionListItem } from "./types.js";
import { fileExists, pluralize, verboseLog } from "./utils.js";

// create progress bar for non-verbose mode
function createProgressBar(total: number): cliProgress.SingleBar | null {
  // only show progress bar if stdout is a TTY (not piped)
  if (!process.stdout.isTTY) {
    return null;
  }

  const bar = new cliProgress.SingleBar({
    format: 'Exporting |{bar}| {percentage}% | {value}/{total} sessions | ETA: {eta_formatted}',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
    etaBuffer: 10,
  }, cliProgress.Presets.shades_classic);

  bar.start(total, 0);
  return bar;
}

// create ExportOptions w/ sensible defaults
export function createExportOptions(
  outDir: string,
  overrides: Partial<Omit<ExportOptions, "outDir">> = {}
): ExportOptions {
  return {
    outDir,
    overwrite: true,
    includeReasoningInOutput: true,
    groupBy: "flat",
    dryRun: false,
    verbose: false,
    ...overrides,
  };
}

// get output subdirectory for session based on groupBy strategy
function getProjectSubdir(session: SessionListItem, groupBy: GroupBy): string {
  switch (groupBy) {
    case "flat":
      return "opencode";
    case "project":
      return `opencode-${session.projectId}`;
    case "directory": {
      // use short hash of directory path for safe filenames
      const hash = createHash("sha256")
        .update(session.directory)
        .digest("hex")
        .slice(0, 12);
      return `opencode-${hash}`;
    }
  }
}

// * run export process & return statistics
export async function runExport(options: ExportOptions): Promise<ExportStats> {
  const stats: ExportStats = {
    sessionsDiscovered: 0,
    sessionsExported: 0,
    sessionsSkipped: 0,
    messagesConverted: 0,
    messagesSkipped: 0,
    errors: [],
  };

  // check OpenCode is available
  const available = await checkOpenCodeAvailable();
  if (!available) {
    throw new Error(
      "OpenCode CLI not found or not working.\n\n" +
        "Please ensure OpenCode is installed and in your PATH:\n" +
        "  1. Install:  npm install -g opencode\n" +
        "  2. Verify:   opencode --version\n" +
        "  3. If installed via Homebrew: brew link opencode\n\n" +
        "If opencode is installed but not found, check your PATH:\n" +
        "  echo $PATH | tr ':' '\\n' | grep -E 'npm|node'"
    );
  }

  // show storage directory being used
  const storageDir = getStorageDir(options.openCodeDir);
  verboseLog(options.verbose, `Using OpenCode storage: ${storageDir}`);

  // discover sessions
  verboseLog(options.verbose, "Discovering sessions...");
  const sessions = await listSessions(options.since, options.openCodeDir);
  stats.sessionsDiscovered = sessions.length;

  if (sessions.length === 0) {
    console.log("No sessions found.");
    return stats;
  }

  verboseLog(
    options.verbose,
    `Found ${pluralize(sessions.length, "session")}`
  );

  // track which directories we've created
  const createdDirs = new Set<string>();

  // create progress bar for non-verbose mode
  const progressBar = !options.verbose ? createProgressBar(sessions.length) : null;
  let processedCount = 0;

  // process each session
  for (const session of sessions) {
    // determine output directory based on groupBy strategy
    const subdir = getProjectSubdir(session, options.groupBy);
    const projectDir = path.join(options.outDir, "projects", subdir);
    const outFile = path.join(projectDir, `${session.id}.jsonl`);

    // create directory if needed
    if (!createdDirs.has(projectDir) && !options.dryRun) {
      await mkdir(projectDir, { recursive: true });
      createdDirs.add(projectDir);
    }

    // skip if exists & not overwriting
    if (!options.overwrite && (await fileExists(outFile))) {
      verboseLog(options.verbose, `Skipping ${session.id} (file exists)`);
      stats.sessionsSkipped++;
      processedCount++;
      progressBar?.update(processedCount);
      continue;
    }

    // export session (must run from session's directory)
    verboseLog(options.verbose, `Exporting ${session.id} from ${session.directory}...`);
    const exported = await exportSessionWithRetry(session.id, session.directory);
    if (!exported) {
      stats.errors.push(`Failed to export session ${session.id}`);
      processedCount++;
      progressBar?.update(processedCount);
      continue;
    }

    // convert to ccusage format
    const result = convertSession(exported, {
      includeReasoningInOutput: options.includeReasoningInOutput,
    });

    stats.messagesConverted += result.lines.length;
    stats.messagesSkipped += result.skippedCount;

    // skip empty sessions
    if (result.lines.length === 0) {
      verboseLog(
        options.verbose,
        `  Skipping ${session.id} (no convertible messages)`
      );
      stats.sessionsSkipped++;
      processedCount++;
      progressBar?.update(processedCount);
      continue;
    }

    // write or preview
    if (options.dryRun) {
      console.log(
        `[dry-run] Would write ${outFile} (${pluralize(result.lines.length, "line")})`
      );
    } else {
      const jsonl = toJsonl(result.lines);
      await writeFile(outFile, jsonl, "utf-8");
      verboseLog(
        options.verbose,
        `  Wrote ${pluralize(result.lines.length, "line")} to ${subdir}/${session.id}.jsonl`
      );
    }

    stats.sessionsExported++;

    // update progress bar
    processedCount++;
    progressBar?.update(processedCount);
  }

  // stop progress bar
  progressBar?.stop();

  return stats;
}

// print export statistics summary
export function printSummary(stats: ExportStats): void {
  console.log("");
  console.log("--- Summary ---");
  console.log(`Sessions discovered: ${stats.sessionsDiscovered}`);
  console.log(`Sessions exported:   ${stats.sessionsExported}`);
  console.log(`Sessions skipped:    ${stats.sessionsSkipped}`);
  console.log(`Messages converted:  ${stats.messagesConverted}`);
  console.log(`Messages skipped:    ${stats.messagesSkipped}`);

  if (stats.errors.length > 0) {
    console.log(`Errors:              ${stats.errors.length}`);
    for (const err of stats.errors) {
      console.log(`  - ${err}`);
    }
  }
}
