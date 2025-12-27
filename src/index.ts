#!/usr/bin/env node
// src/index.ts
// CLI entry point for OpenCode session export to ccusage format

import { createRequire } from "node:module";
import { Command } from "commander";
import { exportCommand, reportCommand } from "./commands/index.js";
import { createExportOptions, printSummary, runExport } from "./exporter.js";
import type { GroupBy } from "./types.js";
import { getErrorMessage, parseSinceOrExit } from "./utils.js";

// import version from package.json to keep it in sync
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const program = new Command()
  .name("opencode-to-ccusage")
  .description("Export OpenCode sessions to ccusage-compatible JSONL format")
  .version(pkg.version);

// add subcommands
program.addCommand(exportCommand);
program.addCommand(reportCommand);

// advanced command for full control (legacy/advanced usage)
const advancedCommand = new Command("advanced")
  .description("Advanced export with full control over all options")
  .requiredOption("--out <dir>", "Output directory (required)")
  .option("--overwrite", "Overwrite existing session files", false)
  .option(
    "--since <value>",
    "Only export sessions after cutoff (ISO date or number of days)"
  )
  .option(
    "--include-reasoning-in-output",
    "Fold reasoning tokens into output_tokens (default: true)"
  )
  .option(
    "--no-include-reasoning-in-output",
    "Exclude reasoning tokens from output_tokens"
  )
  .option(
    "--group-by <strategy>",
    "Group output files: flat (default), project, or directory",
    "flat"
  )
  .option(
    "--opencode-dir <path>",
    "Override OpenCode data directory (default: auto-detected)"
  )
  .option("--dry-run", "Preview without writing files", false)
  .option("--verbose", "Show detailed progress", false  )
  .action(async (opts) => {
    // validate --group-by
    const validGroupBy = ["flat", "project", "directory"];
    if (!validGroupBy.includes(opts.groupBy)) {
      console.error(
        `Error: Invalid --group-by value "${opts.groupBy}". Must be one of: ${validGroupBy.join(", ")}`
      );
      process.exit(1);
    }

    // parse --since if provided
    const since = parseSinceOrExit(opts.since);

    // build options
    const exportOptions = createExportOptions(opts.out, {
      overwrite: opts.overwrite,
      since,
      includeReasoningInOutput: opts.includeReasoningInOutput,
      groupBy: opts.groupBy as GroupBy,
      openCodeDir: opts.opencodeDir,
      dryRun: opts.dryRun,
      verbose: opts.verbose,
    });

    // run export
    try {
      const stats = await runExport(exportOptions);
      printSummary(stats);

      if (stats.errors.length > 0) {
        process.exit(1);
      }
    } catch (err) {
      console.error(`Error: ${getErrorMessage(err)}`);
      process.exit(1);
    }
  });

program.addCommand(advancedCommand);

// default action: run report command if no subcommand provided
const subcommands = ["export", "report", "advanced", "help"];
const helpFlags = ["--help", "-h", "--version", "-V"];

// check if first arg (after node & script) is a known subcommand or help flag
const firstArg = process.argv[2];
const isSubcommand = firstArg && subcommands.includes(firstArg);
const isHelpFlag = firstArg && helpFlags.includes(firstArg);

if (!isSubcommand && !isHelpFlag) {
  // no subcommand provided - insert "report" as the subcommand
  // this allows `--skip-export` to work as `report --skip-export`
  process.argv.splice(2, 0, "report");
}

program.parse();
