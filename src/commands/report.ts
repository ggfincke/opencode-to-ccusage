// src/commands/report.ts
// report command - exports OpenCode sessions & runs ccusage

import { Command } from "commander";
import { createExportOptions, printSummary, runExport } from "../exporter.js";
import {
  checkCcusageAvailable,
  findClaudeConfigDirs,
  OPENCODE_CONFIG_DIR,
  runCcusage,
  runCombinedReport,
} from "../report-runner.js";
import { getErrorMessage, parseSinceOrExit, pluralize, verboseLog } from "../utils.js";

export const reportCommand = new Command("report")
  .description("Export OpenCode sessions and generate usage report with ccusage")
  .option("--opencode-only", "Only show OpenCode usage (skip Claude Code)", false)
  .option("--claude-only", "Only show Claude Code usage (skip export)", false)
  .option("--skip-export", "Skip the export step", false)
  .option(
    "--since <value>",
    "Only export sessions after cutoff (ISO date or number of days)"
  )
  .option(
    "--combine [file]",
    "Run separate ccusage for Claude Code and OpenCode, merge outputs. Optionally provide a ccusage JSON file to merge with instead of running live."
  )
  .option("--json", "Output combined report as JSON (only with --combine)", false)
  .option("-v, --verbose", "Show detailed progress", false)
  .allowUnknownOption(true)
  .action(async (opts, command) => {
    // check if ccusage is available
    const ccusageAvailable = await checkCcusageAvailable();
    if (!ccusageAvailable) {
      console.error(
        "Error: ccusage is not installed or not available.\n\n" +
          "Please install ccusage first:\n" +
          "  npm install -g ccusage\n\n" +
          "Or run with npx:\n" +
          "  npx ccusage --help"
      );
      process.exit(1);
    }

    // parse --since if provided
    const since = parseSinceOrExit(opts.since);

    // get pass-through args for ccusage
    const ccusageArgs = command.args.filter(
      (arg: string) =>
        arg !== "report" &&
        !arg.startsWith("--opencode-only") &&
        !arg.startsWith("--claude-only") &&
        !arg.startsWith("--skip-export") &&
        !arg.startsWith("--since") &&
        !arg.startsWith("--combine") &&
        !arg.startsWith("--json") &&
        !arg.startsWith("-v") &&
        !arg.startsWith("--verbose")
    );

    // handle --combine mode
    if (opts.combine !== undefined) {
      const exitCode = await runCombinedReport({
        combineArg: opts.combine,
        ccusageArgs,
        skipExport: opts.skipExport,
        since,
        verbose: opts.verbose,
        outputJson: opts.json,
      });
      process.exit(exitCode);
    }

    // run export unless skipped or claude-only
    if (!opts.skipExport && !opts.claudeOnly) {
      verboseLog(opts.verbose, "Exporting OpenCode sessions...\n");

      const exportOptions = createExportOptions(OPENCODE_CONFIG_DIR, {
        since,
        verbose: opts.verbose,
      });

      try {
        const stats = await runExport(exportOptions);

        if (opts.verbose) {
          printSummary(stats);
          console.log("");
        } else if (stats.sessionsExported > 0) {
          console.log(`Exported ${pluralize(stats.sessionsExported, "session")}\n`);
        }

        verboseLog(stats.errors.length > 0 && opts.verbose, "Export completed with some errors.\n");
      } catch (err) {
        console.error(`Export error: ${getErrorMessage(err)}`);
        if (!opts.verbose) {
          console.error("Use --verbose for more details.\n");
        }
        // continue to ccusage even if export fails
      }
    }

    // determine which config directories to use
    let configDir: string | undefined;
    if (opts.opencodeOnly) {
      configDir = OPENCODE_CONFIG_DIR;
    } else if (opts.claudeOnly) {
      configDir = undefined;
    } else {
      // combined: find existing Claude dirs & add OpenCode dir
      const claudeDirs = findClaudeConfigDirs();
      const allDirs = [...claudeDirs, OPENCODE_CONFIG_DIR];
      configDir = allDirs.join(",");
    }

    // run ccusage
    verboseLog(opts.verbose, "Running ccusage...\n");

    const exitCode = await runCcusage(configDir, ccusageArgs, opts.verbose);
    process.exit(exitCode);
  });
