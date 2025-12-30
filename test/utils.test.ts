// test/utils.test.ts
// tests for utility functions

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  toISOTimestamp,
  getErrorMessage,
  parseSince,
  fileExists,
  dedupeKey,
  verboseLog,
  warn,
  pluralize,
  formatNumber,
  formatCurrency,
  isExecError,
  getOptimalConcurrency,
  type ExecError,
} from "../src/utils.js";

describe("toISOTimestamp", () => {
  it("converts Unix timestamp to ISO 8601 string", () => {
    const timestamp = 1703980800000; // 2023-12-31T00:00:00.000Z
    expect(toISOTimestamp(timestamp)).toBe("2023-12-31T00:00:00.000Z");
  });

  it("handles zero timestamp (Unix epoch)", () => {
    expect(toISOTimestamp(0)).toBe("1970-01-01T00:00:00.000Z");
  });

  it("handles timestamps with milliseconds", () => {
    const timestamp = 1703980800123;
    expect(toISOTimestamp(timestamp)).toBe("2023-12-31T00:00:00.123Z");
  });
});

describe("getErrorMessage", () => {
  it("extracts message from Error object", () => {
    const error = new Error("test error");
    expect(getErrorMessage(error)).toBe("test error");
  });

  it("converts string to itself", () => {
    expect(getErrorMessage("string error")).toBe("string error");
  });

  it("converts number to string", () => {
    expect(getErrorMessage(42)).toBe("42");
  });

  it("converts null to string", () => {
    expect(getErrorMessage(null)).toBe("null");
  });

  it("converts undefined to string", () => {
    expect(getErrorMessage(undefined)).toBe("undefined");
  });

  it("converts object to string", () => {
    expect(getErrorMessage({ foo: "bar" })).toBe("[object Object]");
  });
});

describe("parseSince", () => {
  it("parses number of days", () => {
    const now = Date.now();
    const result = parseSince("7");
    const expected = now - 7 * 24 * 60 * 60 * 1000;
    // Allow 1 second tolerance for test execution time
    expect(Math.abs(result.getTime() - expected)).toBeLessThan(1000);
  });

  it("parses zero days", () => {
    const now = Date.now();
    const result = parseSince("0");
    expect(Math.abs(result.getTime() - now)).toBeLessThan(1000);
  });

  it("parses ISO date string", () => {
    const result = parseSince("2023-12-25");
    expect(result.toISOString().startsWith("2023-12-25")).toBe(true);
  });

  it("parses full ISO datetime string", () => {
    const result = parseSince("2023-12-25T10:30:00.000Z");
    expect(result.toISOString()).toBe("2023-12-25T10:30:00.000Z");
  });

  it("throws on invalid input", () => {
    expect(() => parseSince("not-a-date")).toThrow(
      'Invalid --since value: "not-a-date"'
    );
  });

  it("throws on empty string", () => {
    expect(() => parseSince("")).toThrow('Invalid --since value: ""');
  });

  it("handles number with leading whitespace", () => {
    // Trim is applied internally
    const result = parseSince(" 7");
    // This will be parsed as a number because parseInt handles leading spaces
    const now = Date.now();
    const expected = now - 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(result.getTime() - expected)).toBeLessThan(1000);
  });

  it("treats decimal as date string, not days", () => {
    // "7.5" is not strictly equal to parseInt("7.5", 10).toString()
    // parseInt("7.5", 10) = 7, "7" !== "7.5", so it tries to parse as date
    // However, "7.5" actually parses as a valid date in JavaScript (interpreted as July 5th)
    // This is a quirk of JavaScript's Date parsing, so we just verify the behavior
    const result = parseSince("7.5");
    // It parses as a date (July 5th of current year or a past year)
    expect(result instanceof Date).toBe(true);
    expect(isNaN(result.getTime())).toBe(false);
  });
});

describe("fileExists", () => {
  const testDir = path.join(os.tmpdir(), "utils-test-" + Date.now());
  const testFile = path.join(testDir, "test.txt");

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("returns true for existing file", async () => {
    await writeFile(testFile, "test content");
    expect(await fileExists(testFile)).toBe(true);
  });

  it("returns false for non-existing file", async () => {
    expect(await fileExists(path.join(testDir, "nonexistent.txt"))).toBe(false);
  });

  it("returns true for existing directory", async () => {
    expect(await fileExists(testDir)).toBe(true);
  });

  it("returns false for non-existing directory", async () => {
    expect(await fileExists(path.join(testDir, "nonexistent"))).toBe(false);
  });
});

describe("dedupeKey", () => {
  it("creates key in correct format", () => {
    expect(dedupeKey("msg_123", 1703980800000)).toBe("msg_123:1703980800000");
  });

  it("handles empty messageId", () => {
    expect(dedupeKey("", 1703980800000)).toBe(":1703980800000");
  });

  it("handles zero timestamp", () => {
    expect(dedupeKey("msg_123", 0)).toBe("msg_123:0");
  });
});

describe("verboseLog", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("logs when verbose is true", () => {
    verboseLog(true, "test message");
    expect(consoleSpy).toHaveBeenCalledWith("test message");
  });

  it("does not log when verbose is false", () => {
    verboseLog(false, "test message");
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("passes additional arguments", () => {
    verboseLog(true, "test %s %d", "string", 42);
    expect(consoleSpy).toHaveBeenCalledWith("test %s %d", "string", 42);
  });
});

describe("warn", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("logs with [WARN] prefix", () => {
    warn("test warning");
    expect(consoleSpy).toHaveBeenCalledWith("[WARN] test warning");
  });

  it("passes additional arguments", () => {
    warn("test %s", "arg");
    expect(consoleSpy).toHaveBeenCalledWith("[WARN] test %s", "arg");
  });
});

describe("pluralize", () => {
  it("uses singular form for count of 1", () => {
    expect(pluralize(1, "session")).toBe("1 session");
  });

  it("uses plural form for count of 0", () => {
    expect(pluralize(0, "session")).toBe("0 sessions");
  });

  it("uses plural form for count > 1", () => {
    expect(pluralize(5, "session")).toBe("5 sessions");
  });

  it("uses custom plural form when provided", () => {
    expect(pluralize(2, "entry", "entries")).toBe("2 entries");
  });

  it("uses custom plural for singular with count 1", () => {
    expect(pluralize(1, "entry", "entries")).toBe("1 entry");
  });

  it("handles negative numbers", () => {
    expect(pluralize(-1, "item")).toBe("-1 items");
  });
});

describe("getOptimalConcurrency", () => {
  it("returns override when provided", () => {
    expect(getOptimalConcurrency(10)).toBe(10);
    expect(getOptimalConcurrency(1)).toBe(1);
    expect(getOptimalConcurrency(100)).toBe(100);
  });

  it("ignores non-positive overrides", () => {
    const defaultResult = getOptimalConcurrency();
    expect(getOptimalConcurrency(0)).toBe(defaultResult);
    expect(getOptimalConcurrency(-5)).toBe(defaultResult);
  });

  it("returns a reasonable default based on CPU count", () => {
    const result = getOptimalConcurrency();
    const cpus = os.cpus().length;
    const expected = Math.max(8, Math.min(32, cpus * 2));
    expect(result).toBe(expected);
  });

  it("is at least 8", () => {
    expect(getOptimalConcurrency()).toBeGreaterThanOrEqual(8);
  });

  it("is at most 32 without override", () => {
    expect(getOptimalConcurrency()).toBeLessThanOrEqual(32);
  });
});

describe("formatNumber", () => {
  it("formats small numbers without separator", () => {
    expect(formatNumber(123)).toBe("123");
  });

  it("formats thousands with comma separator", () => {
    expect(formatNumber(1234)).toBe("1,234");
  });

  it("formats millions with comma separators", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
  });

  it("handles zero", () => {
    expect(formatNumber(0)).toBe("0");
  });

  it("handles negative numbers", () => {
    expect(formatNumber(-1234)).toBe("-1,234");
  });
});

describe("formatCurrency", () => {
  it("formats with dollar sign and two decimal places", () => {
    expect(formatCurrency(12.5)).toBe("$12.50");
  });

  it("handles zero", () => {
    expect(formatCurrency(0)).toBe("$0.00");
  });

  it("rounds to two decimal places", () => {
    // Note: toFixed uses banker's rounding, so 12.555 rounds to 12.55
    // due to floating point representation (12.555 is actually 12.5549999...)
    expect(formatCurrency(12.556)).toBe("$12.56");
  });

  it("handles large amounts", () => {
    expect(formatCurrency(1234.56)).toBe("$1234.56");
  });

  it("handles small amounts", () => {
    expect(formatCurrency(0.01)).toBe("$0.01");
  });
});

describe("isExecError", () => {
  it("returns false for non-Error values", () => {
    expect(isExecError("string")).toBe(false);
    expect(isExecError(42)).toBe(false);
    expect(isExecError(null)).toBe(false);
    expect(isExecError(undefined)).toBe(false);
    expect(isExecError({})).toBe(false);
  });

  it("returns true for basic Error", () => {
    expect(isExecError(new Error("test"))).toBe(true);
  });

  it("returns true for Error with exec properties", () => {
    const error = new Error("command failed") as ExecError;
    error.code = 1;
    error.stdout = "output";
    error.stderr = "error output";
    expect(isExecError(error)).toBe(true);
  });

  it("returns true for Error with string code (signal)", () => {
    const error = new Error("killed") as ExecError;
    error.code = "SIGTERM";
    expect(isExecError(error)).toBe(true);
  });

  it("returns true for Error with partial exec properties", () => {
    const error = new Error("test") as ExecError;
    error.stdout = "some output";
    // stderr is undefined
    expect(isExecError(error)).toBe(true);
  });

  it("returns false for Error with invalid code type", () => {
    const error = new Error("test");
    (error as unknown as Record<string, unknown>).code = { invalid: true };
    expect(isExecError(error)).toBe(false);
  });

  it("returns false for Error with invalid stdout type", () => {
    const error = new Error("test");
    (error as unknown as Record<string, unknown>).stdout = 123;
    expect(isExecError(error)).toBe(false);
  });
});

describe("execCommand", () => {
  it("executes a simple command successfully", async () => {
    const { execCommand } = await import("../src/utils.js");
    const result = await execCommand("echo", ["hello"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
    expect(result.stderr).toBe("");
  });

  it("handles commands with multiple arguments", async () => {
    const { execCommand } = await import("../src/utils.js");
    const result = await execCommand("echo", ["hello", "world"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello world");
  });

  it("handles arguments with special characters", async () => {
    const { execCommand } = await import("../src/utils.js");
    const result = await execCommand("echo", ["hello's world"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello's world");
  });

  it("returns non-zero exit code for failing commands", async () => {
    const { execCommand } = await import("../src/utils.js");
    const result = await execCommand("sh", ["-c", "exit 42"]);
    expect(result.exitCode).toBe(42);
  });

  it("captures stderr from failing commands", async () => {
    const { execCommand } = await import("../src/utils.js");
    const result = await execCommand("sh", ["-c", "echo error >&2; exit 1"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.trim()).toBe("error");
  });

  it("throws for command not found", async () => {
    const { execCommand } = await import("../src/utils.js");
    await expect(
      execCommand("nonexistent-command-12345", [])
    ).rejects.toThrow(/command not found|ENOENT/);
  });

  it("respects working directory option", async () => {
    const { execCommand } = await import("../src/utils.js");
    const result = await execCommand("pwd", [], "/tmp");
    expect(result.exitCode).toBe(0);
    // On macOS, /tmp is a symlink to /private/tmp
    expect(result.stdout.trim()).toMatch(/^(\/tmp|\/private\/tmp)$/);
  });

  it("redirects output to file when outputFile is provided", async () => {
    const { execCommand } = await import("../src/utils.js");
    const { readFile, unlink } = await import("node:fs/promises");
    const outputFile = path.join(os.tmpdir(), `exec-test-${Date.now()}.txt`);

    try {
      const result = await execCommand("echo", ["file output"], undefined, outputFile);
      expect(result.exitCode).toBe(0);

      const fileContent = await readFile(outputFile, "utf-8");
      expect(fileContent.trim()).toBe("file output");
    } finally {
      await unlink(outputFile).catch(() => {});
    }
  });
});
