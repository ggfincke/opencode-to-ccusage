// src/exporter.ts
// main export orchestration & statistics

import { createHash } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import cliProgress from "cli-progress";
import pLimit from "p-limit";
import { convertSession, toJsonl } from "./converter.js";
import {
  checkOpenCodeAvailable,
  exportSessionWithRetry,
  getStorageDir,
  listSessions,
} from "./session.js";
import type { ExportOptions, ExportStats, GroupBy, SessionListItem } from "./types.js";
import { fileExists, getOptimalConcurrency, pluralize, verboseLog } from "./utils.js";

// default error rate threshold (25%) - abort if exceeded
const DEFAULT_ERROR_THRESHOLD = 0.25;

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

// result from processing a single session
interface SessionResult {
  exported: boolean;
  skipped: boolean;
  messagesConverted: number;
  messagesSkipped: number;
  error?: string;
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

  // determine concurrency level (use override if provided)
  const concurrency = getOptimalConcurrency(options.concurrency);
  verboseLog(
    options.verbose,
    `Found ${pluralize(sessions.length, "session")}, processing with concurrency ${concurrency}`
  );

  // track which directories we've created (thread-safe via pre-creation)
  const createdDirs = new Set<string>();

  // pre-create all needed directories to avoid race conditions
  if (!options.dryRun) {
    const dirsToCreate = new Set<string>();
    for (const session of sessions) {
      const subdir = getProjectSubdir(session, options.groupBy);
      const projectDir = path.join(options.outDir, "projects", subdir);
      dirsToCreate.add(projectDir);
    }
    await Promise.all(
      Array.from(dirsToCreate).map(async (dir) => {
        await mkdir(dir, { recursive: true });
        createdDirs.add(dir);
      })
    );
  }

  // create progress bar for non-verbose mode
  const progressBar = !options.verbose ? createProgressBar(sessions.length) : null;
  let processedCount = 0;
  let errorCount = 0;
  let aborted = false;

  // create concurrency limiter
  const limit = pLimit(concurrency);

  // process single session (returns result, doesn't mutate stats directly)
  async function processSession(session: SessionListItem): Promise<SessionResult> {
    // check if we should abort due to high error rate
    if (aborted) {
      return { exported: false, skipped: true, messagesConverted: 0, messagesSkipped: 0 };
    }

    const subdir = getProjectSubdir(session, options.groupBy);
    const projectDir = path.join(options.outDir, "projects", subdir);
    const outFile = path.join(projectDir, `${session.id}.jsonl`);

    // skip if exists & not overwriting
    if (!options.overwrite && (await fileExists(outFile))) {
      verboseLog(options.verbose, `Skipping ${session.id} (file exists)`);
      return { exported: false, skipped: true, messagesConverted: 0, messagesSkipped: 0 };
    }

    // incremental mode: skip if output file is newer than session update time
    if (options.incremental && (await fileExists(outFile))) {
      try {
        const fileStat = await stat(outFile);
        // session.updated is in ms, stat.mtimeMs is in ms
        if (fileStat.mtimeMs >= session.updated) {
          verboseLog(options.verbose, `Skipping ${session.id} (unchanged since last export)`);
          return { exported: false, skipped: true, messagesConverted: 0, messagesSkipped: 0 };
        }
      } catch {
        // if stat fails, proceed with export
      }
    }

    // export session (must run from session's directory)
    verboseLog(options.verbose, `Exporting ${session.id} from ${session.directory}...`);
    const exported = await exportSessionWithRetry(session.id, session.directory, 1, {
      skipValidation: options.skipValidation,
    });
    if (!exported) {
      return {
        exported: false,
        skipped: false,
        messagesConverted: 0,
        messagesSkipped: 0,
        error: `Failed to export session ${session.id}`,
      };
    }

    // convert to ccusage format
    const result = convertSession(exported, {
      includeReasoningInOutput: options.includeReasoningInOutput,
    });

    // skip empty sessions
    if (result.lines.length === 0) {
      verboseLog(
        options.verbose,
        `  Skipping ${session.id} (no convertible messages)`
      );
      return {
        exported: false,
        skipped: true,
        messagesConverted: 0,
        messagesSkipped: result.skippedCount,
      };
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

    return {
      exported: true,
      skipped: false,
      messagesConverted: result.lines.length,
      messagesSkipped: result.skippedCount,
    };
  }

  // process all sessions in parallel with concurrency limit
  const tasks = sessions.map((session) =>
    limit(async () => {
      const result = await processSession(session);

      // update progress (atomic increment)
      processedCount++;
      progressBar?.update(processedCount);

      // track errors and check threshold
      if (result.error) {
        errorCount++;
        const errorRate = errorCount / processedCount;
        if (errorRate > DEFAULT_ERROR_THRESHOLD && processedCount >= 10) {
          aborted = true;
        }
      }

      return result;
    })
  );

  // wait for all tasks to complete
  const results = await Promise.all(tasks);

  // stop progress bar
  progressBar?.stop();

  // aggregate results
  for (const result of results) {
    if (result.exported) {
      stats.sessionsExported++;
    } else if (result.skipped) {
      stats.sessionsSkipped++;
    }
    if (result.error) {
      stats.errors.push(result.error);
    }
    stats.messagesConverted += result.messagesConverted;
    stats.messagesSkipped += result.messagesSkipped;
  }

  // report if aborted due to high error rate
  if (aborted) {
    const errorRate = (errorCount / processedCount * 100).toFixed(1);
    console.error(
      `\nAborted: Error rate (${errorRate}%) exceeded threshold (${DEFAULT_ERROR_THRESHOLD * 100}%)`
    );
  }

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
