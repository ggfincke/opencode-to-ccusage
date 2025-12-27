// test/report-runner.test.ts
// tests for report runner utilities

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { findClaudeConfigDirs } from "../src/report-runner.js";
import { CLAUDE_CONFIG_PATHS } from "../src/constants.js";

describe("findClaudeConfigDirs", () => {
  it("returns an array", () => {
    const result = findClaudeConfigDirs();
    expect(Array.isArray(result)).toBe(true);
  });

  it("only returns directories that exist with projects/ subdirectory", () => {
    const result = findClaudeConfigDirs();

    // Each returned directory should exist and have a projects/ subdirectory
    for (const dir of result) {
      const projectsDir = path.join(dir, "projects");
      expect(existsSync(projectsDir)).toBe(true);
    }
  });

  it("only returns directories from the known Claude config paths", () => {
    const result = findClaudeConfigDirs();

    // Each returned directory should be one of the known paths
    for (const dir of result) {
      expect(CLAUDE_CONFIG_PATHS).toContain(dir);
    }
  });

  it("returns at most as many directories as known config paths", () => {
    const result = findClaudeConfigDirs();
    expect(result.length).toBeLessThanOrEqual(CLAUDE_CONFIG_PATHS.length);
  });
});

describe("CLAUDE_CONFIG_PATHS", () => {
  it("contains expected paths", () => {
    expect(CLAUDE_CONFIG_PATHS).toContain(path.join(os.homedir(), ".config", "claude"));
    expect(CLAUDE_CONFIG_PATHS).toContain(path.join(os.homedir(), ".claude"));
  });
});
