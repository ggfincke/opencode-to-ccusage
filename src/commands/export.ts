// src/commands/export.ts
// export command - exports OpenCode sessions to ccusage-compatible JSONL

import { Command } from "commander";
import { OPENCODE_CONFIG_DIR } from "../constants.js";
import { createExportOptions, printSummary, runExport } from "../exporter.js";
import { getErrorMessage, parseSinceOrExit, pluralize } from "../utils.js";

export const exportCommand = new Command("export")
  .description("Export OpenCode sessions to ccusage-compatible JSONL format")
  .option(
    "--out <dir>",
    "Output directory (default: ~/.config/claude-opencode)",
    OPENCODE_CONFIG_DIR
  )
  .option(
    "--since <value>",
    "Only export sessions after cutoff (ISO date or number of days)"
  )
  .option("--dry-run", "Preview without writing files", false)
  .option("-v, --verbose", "Show detailed progress", false)
  .option(
    "-c, --concurrency <number>",
    "Number of parallel exports (default: auto-detected based on CPU)",
    (val) => parseInt(val, 10)
  )
  .option(
    "--incremental",
    "Only re-export sessions updated since last export",
    false
  )
  .option(
    "--skip-validation",
    "Skip schema validation for faster processing",
    false
  )
  .action(async (opts) => {
    const since = parseSinceOrExit(opts.since);

    const exportOptions = createExportOptions(opts.out, {
      since,
      dryRun: opts.dryRun,
      verbose: opts.verbose,
      concurrency: opts.concurrency,
      incremental: opts.incremental,
      skipValidation: opts.skipValidation,
    });

    try {
      const stats = await runExport(exportOptions);

      // only print summary in verbose mode or if there were errors
      if (opts.verbose || stats.errors.length > 0) {
        printSummary(stats);
      } else {
        // minimal output
        if (stats.sessionsExported > 0) {
          console.log(`Exported ${pluralize(stats.sessionsExported, "session")} to ${opts.out}`);
        } else if (stats.sessionsDiscovered === 0) {
          console.log("No sessions found.");
        } else {
          console.log("No new sessions to export.");
        }
      }

      if (stats.errors.length > 0) {
        process.exit(1);
      }
    } catch (err) {
      console.error(`Error: ${getErrorMessage(err)}`);
      process.exit(1);
    }
  });
