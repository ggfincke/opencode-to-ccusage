// src/ccusage-merge.ts
// ccusage merge utilities - combines ccusage JSON outputs from multiple sources

import { exec } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import Table from "cli-table3";
import {
  CcusageDailyOutputSchema,
  type CcusageDailyOutput,
  type DailyEntry,
  type MergedDailyOutput,
  type ModelBreakdown,
  type Totals,
} from "./types.js";
import { formatCurrency, formatNumber, getErrorMessage, verboseLog } from "./utils.js";

const execAsync = promisify(exec);

// run ccusage & capture JSON output
export async function runCcusageJson(
  configDir: string | undefined,
  args: string[] = [],
  verbose = false
): Promise<CcusageDailyOutput | null> {
  // build command - only set CLAUDE_CONFIG_DIR if configDir is provided
  const envPrefix = configDir ? `CLAUDE_CONFIG_DIR="${configDir}" ` : "";
  const command = `${envPrefix}npx ccusage ${args.join(" ")} --json`;

  verboseLog(verbose, `Running: ${command}`);

  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (stderr && verbose) {
      console.error(`ccusage stderr: ${stderr}`);
    }

    // parse & validate JSON output
    let jsonData: unknown;
    try {
      jsonData = JSON.parse(stdout);
    } catch {
      if (verbose) {
        console.error("Failed to parse ccusage output as JSON");
      }
      return null;
    }
    const parsed = CcusageDailyOutputSchema.safeParse(jsonData);
    if (!parsed.success) {
      if (verbose) {
        console.error(`Invalid ccusage output: ${parsed.error.message}`);
      }
      return null;
    }
    return parsed.data;
  } catch (err) {
    if (verbose) {
      console.error(`Failed to run ccusage: ${getErrorMessage(err)}`);
    }
    return null;
  }
}

// load ccusage JSON output from file
export async function loadCcusageJson(
  filePath: string
): Promise<CcusageDailyOutput | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    let jsonData: unknown;
    try {
      jsonData = JSON.parse(content);
    } catch {
      return null;
    }
    const parsed = CcusageDailyOutputSchema.safeParse(jsonData);
    if (!parsed.success) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

// merge model breakdowns from multiple sources
function mergeModelBreakdowns(breakdowns: ModelBreakdown[]): ModelBreakdown[] {
  const byModel = new Map<string, ModelBreakdown>();

  for (const breakdown of breakdowns) {
    const existing = byModel.get(breakdown.modelName);
    if (existing) {
      existing.inputTokens += breakdown.inputTokens;
      existing.outputTokens += breakdown.outputTokens;
      existing.cacheCreationTokens += breakdown.cacheCreationTokens;
      existing.cacheReadTokens += breakdown.cacheReadTokens;
      existing.cost += breakdown.cost;
    } else {
      byModel.set(breakdown.modelName, { ...breakdown });
    }
  }

  // sort by cost descending
  return Array.from(byModel.values()).sort((a, b) => b.cost - a.cost);
}

// * merge daily entries from multiple sources (keep separate to show source info)
export function mergeDailyReports(
  reports: { data: CcusageDailyOutput; source: string }[]
): MergedDailyOutput {
  const allEntries: DailyEntry[] = [];
  const sources: string[] = [];

  for (const { data, source } of reports) {
    sources.push(source);
    for (const entry of data.daily) {
      allEntries.push({
        ...entry,
        source,
      });
    }
  }

  // sort by date descending (most recent first)
  allEntries.sort((a, b) => b.date.localeCompare(a.date));

  // calculate combined totals
  const totals: Totals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    totalCost: 0,
  };

  for (const entry of allEntries) {
    totals.inputTokens += entry.inputTokens;
    totals.outputTokens += entry.outputTokens;
    totals.cacheCreationTokens += entry.cacheCreationTokens;
    totals.cacheReadTokens += entry.cacheReadTokens;
    totals.totalTokens += entry.totalTokens;
    totals.totalCost += entry.totalCost;
  }

  return {
    daily: allEntries,
    totals,
    sources,
  };
}

// merge daily entries aggregated by date (combines entries w/ same date)
export function mergeDailyReportsAggregated(
  reports: { data: CcusageDailyOutput; source: string }[]
): MergedDailyOutput {
  const byDate = new Map<
    string,
    {
      entry: DailyEntry;
      sources: Set<string>;
    }
  >();
  const sources: string[] = [];

  for (const { data, source } of reports) {
    sources.push(source);
    for (const entry of data.daily) {
      const existing = byDate.get(entry.date);
      if (existing) {
        // aggregate entry
        existing.entry.inputTokens += entry.inputTokens;
        existing.entry.outputTokens += entry.outputTokens;
        existing.entry.cacheCreationTokens += entry.cacheCreationTokens;
        existing.entry.cacheReadTokens += entry.cacheReadTokens;
        existing.entry.totalTokens += entry.totalTokens;
        existing.entry.totalCost += entry.totalCost;
        existing.entry.modelsUsed = [
          ...new Set([...existing.entry.modelsUsed, ...entry.modelsUsed]),
        ];
        existing.entry.modelBreakdowns = mergeModelBreakdowns([
          ...existing.entry.modelBreakdowns,
          ...entry.modelBreakdowns,
        ]);
        existing.sources.add(source);
      } else {
        byDate.set(entry.date, {
          entry: { ...entry },
          sources: new Set([source]),
        });
      }
    }
  }

  // convert to array & add source info
  const allEntries: DailyEntry[] = [];
  for (const [, { entry, sources: entrySources }] of byDate) {
    allEntries.push({
      ...entry,
      source:
        entrySources.size > 1
          ? Array.from(entrySources).join(" + ")
          : Array.from(entrySources)[0],
    });
  }

  // sort by date descending
  allEntries.sort((a, b) => b.date.localeCompare(a.date));

  // calculate combined totals
  const totals: Totals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    totalCost: 0,
  };

  for (const entry of allEntries) {
    totals.inputTokens += entry.inputTokens;
    totals.outputTokens += entry.outputTokens;
    totals.cacheCreationTokens += entry.cacheCreationTokens;
    totals.cacheReadTokens += entry.cacheReadTokens;
    totals.totalTokens += entry.totalTokens;
    totals.totalCost += entry.totalCost;
  }

  return {
    daily: allEntries,
    totals,
    sources: [...new Set(sources)],
  };
}

// format model name to shorter version for display
function formatModelName(modelName: string): string {
  const match = modelName.match(/claude-(\w+)-([\d-]+)-(\d{8})/);
  if (match) {
    return `${match[1]}-${match[2]}`;
  }
  return modelName;
}

// format models for display as comma-separated list
function formatModelsDisplay(models: string[], maxLength?: number): string {
  const uniqueModels = [...new Set(models.map(formatModelName))];
  const sorted = uniqueModels.sort();
  const joined = sorted.join(", ");

  if (maxLength && joined.length > maxLength) {
    return joined.slice(0, maxLength - 3) + "...";
  }

  return joined;
}

// format source label w/ optional shortening for compact mode
function formatSourceLabel(source: string, compact: boolean): string {
  if (!compact) return source;

  // shorten labels for narrow terminals
  switch (source) {
    case "Claude Code":
      return "Claude";
    case "OpenCode":
      return "OC";
    case "Claude Code + OpenCode":
      return "Claude+OC";
    default:
      return source.length > 10 ? source.slice(0, 7) + "..." : source;
  }
}

const colors = {
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
};

// * render merged output as table using cli-table3
export function renderMergedTable(
  output: MergedDailyOutput,
  compact = false
): string {
  const lines: string[] = [];

  // header
  lines.push("");
  lines.push(
    `${colors.bold}Combined Usage Report${colors.reset} (${output.sources.join(" + ")})`
  );
  lines.push("");

  if (compact) {
    // compact table - fewer columns
    const table = new Table({
      head: [
        `${colors.cyan}Date${colors.reset}`,
        `${colors.cyan}Source${colors.reset}`,
        `${colors.cyan}Input${colors.reset}`,
        `${colors.cyan}Output${colors.reset}`,
        `${colors.cyan}Cost${colors.reset}`,
      ],
      colAligns: ["left", "left", "right", "right", "right"],
    });

    // data rows
    for (const entry of output.daily) {
      table.push([
        entry.date,
        formatSourceLabel(entry.source ?? "unknown", true),
        formatNumber(entry.inputTokens),
        formatNumber(entry.outputTokens),
        formatCurrency(entry.totalCost),
      ]);
    }

    // totals row
    table.push([
      `${colors.yellow}Total${colors.reset}`,
      "",
      `${colors.yellow}${formatNumber(output.totals.inputTokens)}${colors.reset}`,
      `${colors.yellow}${formatNumber(output.totals.outputTokens)}${colors.reset}`,
      `${colors.yellow}${formatCurrency(output.totals.totalCost)}${colors.reset}`,
    ]);

    lines.push(table.toString());
  } else {
    // full table - all columns
    const table = new Table({
      head: [
        `${colors.cyan}Date${colors.reset}`,
        `${colors.cyan}Source${colors.reset}`,
        `${colors.cyan}Models${colors.reset}`,
        `${colors.cyan}Input${colors.reset}`,
        `${colors.cyan}Output${colors.reset}`,
        `${colors.cyan}Cache Create${colors.reset}`,
        `${colors.cyan}Cache Read${colors.reset}`,
        `${colors.cyan}Total${colors.reset}`,
        `${colors.cyan}Cost${colors.reset}`,
      ],
      colAligns: [
        "left",
        "left",
        "left",
        "right",
        "right",
        "right",
        "right",
        "right",
        "right",
      ],
    });

    // data rows
    for (const entry of output.daily) {
      table.push([
        entry.date,
        formatSourceLabel(entry.source ?? "unknown", false),
        formatModelsDisplay(entry.modelsUsed, 20),
        formatNumber(entry.inputTokens),
        formatNumber(entry.outputTokens),
        formatNumber(entry.cacheCreationTokens),
        formatNumber(entry.cacheReadTokens),
        formatNumber(entry.totalTokens),
        formatCurrency(entry.totalCost),
      ]);
    }

    // totals row
    table.push([
      `${colors.yellow}Total${colors.reset}`,
      "",
      "",
      `${colors.yellow}${formatNumber(output.totals.inputTokens)}${colors.reset}`,
      `${colors.yellow}${formatNumber(output.totals.outputTokens)}${colors.reset}`,
      `${colors.yellow}${formatNumber(output.totals.cacheCreationTokens)}${colors.reset}`,
      `${colors.yellow}${formatNumber(output.totals.cacheReadTokens)}${colors.reset}`,
      `${colors.yellow}${formatNumber(output.totals.totalTokens)}${colors.reset}`,
      `${colors.yellow}${formatCurrency(output.totals.totalCost)}${colors.reset}`,
    ]);

    lines.push(table.toString());
  }

  lines.push("");

  return lines.join("\n");
}

// render merged output as compact table (convenience wrapper)
export function renderMergedTableCompact(output: MergedDailyOutput): string {
  return renderMergedTable(output, true);
}
