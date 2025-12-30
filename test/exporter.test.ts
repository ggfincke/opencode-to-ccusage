// test/exporter.test.ts
// tests for export orchestration functions

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createExportOptions, printSummary } from "../src/exporter.js";
import type { ExportStats } from "../src/types.js";

describe("createExportOptions", () => {
  it("creates options with required outDir", () => {
    const options = createExportOptions("/output/dir");
    expect(options.outDir).toBe("/output/dir");
  });

  it("applies sensible defaults", () => {
    const options = createExportOptions("/output/dir");
    expect(options.overwrite).toBe(true);
    expect(options.includeReasoningInOutput).toBe(true);
    expect(options.groupBy).toBe("flat");
    expect(options.dryRun).toBe(false);
    expect(options.verbose).toBe(false);
  });

  it("allows overriding defaults", () => {
    const options = createExportOptions("/output/dir", {
      overwrite: false,
      includeReasoningInOutput: false,
      groupBy: "project",
      dryRun: true,
      verbose: true,
    });

    expect(options.outDir).toBe("/output/dir");
    expect(options.overwrite).toBe(false);
    expect(options.includeReasoningInOutput).toBe(false);
    expect(options.groupBy).toBe("project");
    expect(options.dryRun).toBe(true);
    expect(options.verbose).toBe(true);
  });

  it("allows setting since date", () => {
    const since = new Date("2024-01-01");
    const options = createExportOptions("/output/dir", { since });
    expect(options.since).toBe(since);
  });

  it("allows setting openCodeDir", () => {
    const options = createExportOptions("/output/dir", {
      openCodeDir: "/custom/opencode",
    });
    expect(options.openCodeDir).toBe("/custom/opencode");
  });

  it("supports directory groupBy strategy", () => {
    const options = createExportOptions("/output/dir", {
      groupBy: "directory",
    });
    expect(options.groupBy).toBe("directory");
  });

  it("allows setting concurrency override", () => {
    const options = createExportOptions("/output/dir", {
      concurrency: 16,
    });
    expect(options.concurrency).toBe(16);
  });

  it("allows enabling incremental mode", () => {
    const options = createExportOptions("/output/dir", {
      incremental: true,
    });
    expect(options.incremental).toBe(true);
  });

  it("allows enabling skipValidation", () => {
    const options = createExportOptions("/output/dir", {
      skipValidation: true,
    });
    expect(options.skipValidation).toBe(true);
  });

  it("defaults new performance options to undefined/false", () => {
    const options = createExportOptions("/output/dir");
    expect(options.concurrency).toBeUndefined();
    expect(options.incremental).toBeUndefined();
    expect(options.skipValidation).toBeUndefined();
  });
});

describe("printSummary", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("prints basic stats", () => {
    const stats: ExportStats = {
      sessionsDiscovered: 10,
      sessionsExported: 8,
      sessionsSkipped: 2,
      messagesConverted: 100,
      messagesSkipped: 5,
      errors: [],
    };

    printSummary(stats);

    expect(consoleSpy).toHaveBeenCalledWith("");
    expect(consoleSpy).toHaveBeenCalledWith("--- Summary ---");
    expect(consoleSpy).toHaveBeenCalledWith("Sessions discovered: 10");
    expect(consoleSpy).toHaveBeenCalledWith("Sessions exported:   8");
    expect(consoleSpy).toHaveBeenCalledWith("Sessions skipped:    2");
    expect(consoleSpy).toHaveBeenCalledWith("Messages converted:  100");
    expect(consoleSpy).toHaveBeenCalledWith("Messages skipped:    5");
  });

  it("prints errors when present", () => {
    const stats: ExportStats = {
      sessionsDiscovered: 5,
      sessionsExported: 3,
      sessionsSkipped: 0,
      messagesConverted: 50,
      messagesSkipped: 0,
      errors: ["Error 1", "Error 2"],
    };

    printSummary(stats);

    expect(consoleSpy).toHaveBeenCalledWith("Errors:              2");
    expect(consoleSpy).toHaveBeenCalledWith("  - Error 1");
    expect(consoleSpy).toHaveBeenCalledWith("  - Error 2");
  });

  it("does not print errors line when no errors", () => {
    const stats: ExportStats = {
      sessionsDiscovered: 5,
      sessionsExported: 5,
      sessionsSkipped: 0,
      messagesConverted: 50,
      messagesSkipped: 0,
      errors: [],
    };

    printSummary(stats);

    // Should not have any call containing "Errors:"
    const calls = consoleSpy.mock.calls.map((call) => call[0]);
    expect(calls.some((call) => String(call).includes("Errors:"))).toBe(false);
  });

  it("handles zero values", () => {
    const stats: ExportStats = {
      sessionsDiscovered: 0,
      sessionsExported: 0,
      sessionsSkipped: 0,
      messagesConverted: 0,
      messagesSkipped: 0,
      errors: [],
    };

    printSummary(stats);

    expect(consoleSpy).toHaveBeenCalledWith("Sessions discovered: 0");
    expect(consoleSpy).toHaveBeenCalledWith("Sessions exported:   0");
  });
});
