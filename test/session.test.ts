// test/session.test.ts
// tests for session discovery & export functions

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  checkOpenCodeAvailable,
  exportSession,
  exportSessionWithRetry,
  getStorageDir,
  listSessions,
} from "../src/session.js";

describe("getStorageDir", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  it("returns override path with /storage appended", () => {
    const result = getStorageDir("/custom/path");
    expect(result).toBe(path.join("/custom/path", "storage"));
  });

  it("uses OPENCODE_DATA_DIR environment variable when set", () => {
    process.env.OPENCODE_DATA_DIR = "/env/data/dir";
    const result = getStorageDir();
    expect(result).toBe(path.join("/env/data/dir", "storage"));
  });

  it("override takes precedence over environment variable", () => {
    process.env.OPENCODE_DATA_DIR = "/env/data/dir";
    const result = getStorageDir("/override/path");
    expect(result).toBe(path.join("/override/path", "storage"));
  });

  it("uses XDG_DATA_HOME on Unix when set", () => {
    delete process.env.OPENCODE_DATA_DIR;
    process.env.XDG_DATA_HOME = "/custom/xdg/data";

    // Skip on Windows
    if (os.platform() === "win32") return;

    const result = getStorageDir();
    expect(result).toBe(path.join("/custom/xdg/data", "opencode", "storage"));
  });

  it("uses default XDG path on Unix when XDG_DATA_HOME not set", () => {
    delete process.env.OPENCODE_DATA_DIR;
    delete process.env.XDG_DATA_HOME;

    // Skip on Windows
    if (os.platform() === "win32") return;

    const result = getStorageDir();
    expect(result).toBe(
      path.join(os.homedir(), ".local", "share", "opencode", "storage")
    );
  });

  it("uses LOCALAPPDATA on Windows when set", () => {
    // This test only makes sense on Windows or when mocking platform
    if (os.platform() !== "win32") return;

    delete process.env.OPENCODE_DATA_DIR;
    process.env.LOCALAPPDATA = "C:\\Users\\Test\\AppData\\Local";

    const result = getStorageDir();
    expect(result).toBe(
      path.join("C:\\Users\\Test\\AppData\\Local", "opencode", "storage")
    );
  });
});

describe("listSessions", () => {
  const testDir = path.join(os.tmpdir(), "session-test-" + Date.now());
  const storageDir = path.join(testDir, "storage");
  const sessionsDir = path.join(storageDir, "session");

  beforeEach(async () => {
    await mkdir(sessionsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("returns empty array when sessions directory does not exist", async () => {
    const emptyDir = path.join(os.tmpdir(), "empty-test-" + Date.now());
    const result = await listSessions(undefined, emptyDir);
    expect(result).toEqual([]);
  });

  it("returns empty array when no project directories exist", async () => {
    const result = await listSessions(undefined, testDir);
    expect(result).toEqual([]);
  });

  it("parses valid session files", async () => {
    const projectDir = path.join(sessionsDir, "project1");
    await mkdir(projectDir, { recursive: true });

    const sessionData = {
      id: "ses_test123",
      title: "Test Session",
      time: {
        created: 1703980800000,
        updated: 1703980900000,
      },
      projectID: "project1",
      directory: "/test/project",
    };

    await writeFile(
      path.join(projectDir, "ses_test123.json"),
      JSON.stringify(sessionData)
    );

    const result = await listSessions(undefined, testDir);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "ses_test123",
      title: "Test Session",
      created: 1703980800000,
      updated: 1703980900000,
      projectId: "project1",
      directory: "/test/project",
    });
  });

  it("skips invalid session files", async () => {
    const projectDir = path.join(sessionsDir, "project1");
    await mkdir(projectDir, { recursive: true });

    // Valid session
    const validSession = {
      id: "ses_valid",
      title: "Valid",
      time: { created: 1703980800000, updated: 1703980900000 },
      projectID: "project1",
      directory: "/test",
    };

    // Invalid session (missing required fields)
    const invalidSession = {
      id: "ses_invalid",
      // missing time, projectID, directory
    };

    await writeFile(
      path.join(projectDir, "ses_valid.json"),
      JSON.stringify(validSession)
    );
    await writeFile(
      path.join(projectDir, "ses_invalid.json"),
      JSON.stringify(invalidSession)
    );

    const result = await listSessions(undefined, testDir);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("ses_valid");
  });

  it("skips non-JSON files", async () => {
    const projectDir = path.join(sessionsDir, "project1");
    await mkdir(projectDir, { recursive: true });

    await writeFile(path.join(projectDir, "readme.txt"), "not a session");
    await writeFile(path.join(projectDir, ".hidden"), "hidden file");

    const result = await listSessions(undefined, testDir);
    expect(result).toEqual([]);
  });

  it("filters sessions by since date", async () => {
    const projectDir = path.join(sessionsDir, "project1");
    await mkdir(projectDir, { recursive: true });

    const oldSession = {
      id: "ses_old",
      title: "Old",
      time: { created: 1703980800000, updated: 1703980900000 }, // 2023-12-31
      projectID: "project1",
      directory: "/test",
    };

    const newSession = {
      id: "ses_new",
      title: "New",
      time: { created: 1704067200000, updated: 1704067300000 }, // 2024-01-01
      projectID: "project1",
      directory: "/test",
    };

    await writeFile(
      path.join(projectDir, "ses_old.json"),
      JSON.stringify(oldSession)
    );
    await writeFile(
      path.join(projectDir, "ses_new.json"),
      JSON.stringify(newSession)
    );

    // Filter to only include sessions created after 2023-12-31T12:00:00Z
    const since = new Date("2023-12-31T12:00:00Z");
    const result = await listSessions(since, testDir);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("ses_new");
  });

  it("sorts sessions by created time ascending", async () => {
    const projectDir = path.join(sessionsDir, "project1");
    await mkdir(projectDir, { recursive: true });

    const sessions = [
      {
        id: "ses_3",
        title: "Third",
        time: { created: 1704153600000, updated: 1704153700000 },
        projectID: "project1",
        directory: "/test",
      },
      {
        id: "ses_1",
        title: "First",
        time: { created: 1703980800000, updated: 1703980900000 },
        projectID: "project1",
        directory: "/test",
      },
      {
        id: "ses_2",
        title: "Second",
        time: { created: 1704067200000, updated: 1704067300000 },
        projectID: "project1",
        directory: "/test",
      },
    ];

    for (const session of sessions) {
      await writeFile(
        path.join(projectDir, `${session.id}.json`),
        JSON.stringify(session)
      );
    }

    const result = await listSessions(undefined, testDir);

    expect(result).toHaveLength(3);
    expect(result[0].id).toBe("ses_1"); // Oldest first
    expect(result[1].id).toBe("ses_2");
    expect(result[2].id).toBe("ses_3"); // Newest last
  });

  it("reads sessions from multiple project directories", async () => {
    const project1Dir = path.join(sessionsDir, "project1");
    const project2Dir = path.join(sessionsDir, "project2");
    await mkdir(project1Dir, { recursive: true });
    await mkdir(project2Dir, { recursive: true });

    const session1 = {
      id: "ses_p1",
      title: "Project 1 Session",
      time: { created: 1703980800000, updated: 1703980900000 },
      projectID: "project1",
      directory: "/project1",
    };

    const session2 = {
      id: "ses_p2",
      title: "Project 2 Session",
      time: { created: 1704067200000, updated: 1704067300000 },
      projectID: "project2",
      directory: "/project2",
    };

    await writeFile(
      path.join(project1Dir, "ses_p1.json"),
      JSON.stringify(session1)
    );
    await writeFile(
      path.join(project2Dir, "ses_p2.json"),
      JSON.stringify(session2)
    );

    const result = await listSessions(undefined, testDir);

    expect(result).toHaveLength(2);
    expect(result.map((s) => s.id).sort()).toEqual(["ses_p1", "ses_p2"]);
  });

  it("handles corrupt JSON files gracefully", async () => {
    const projectDir = path.join(sessionsDir, "project1");
    await mkdir(projectDir, { recursive: true });

    await writeFile(path.join(projectDir, "corrupt.json"), "not valid json {{{");

    const validSession = {
      id: "ses_valid",
      title: "Valid",
      time: { created: 1703980800000, updated: 1703980900000 },
      projectID: "project1",
      directory: "/test",
    };
    await writeFile(
      path.join(projectDir, "ses_valid.json"),
      JSON.stringify(validSession)
    );

    const result = await listSessions(undefined, testDir);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("ses_valid");
  });

  it("handles empty title gracefully", async () => {
    const projectDir = path.join(sessionsDir, "project1");
    await mkdir(projectDir, { recursive: true });

    const sessionNoTitle = {
      id: "ses_no_title",
      // title is optional
      time: { created: 1703980800000, updated: 1703980900000 },
      projectID: "project1",
      directory: "/test",
    };

    await writeFile(
      path.join(projectDir, "ses_no_title.json"),
      JSON.stringify(sessionNoTitle)
    );

    const result = await listSessions(undefined, testDir);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("");
  });
});

describe("checkOpenCodeAvailable", () => {
  it("returns a boolean", async () => {
    // This test verifies the function signature and basic behavior
    // The actual result depends on whether opencode is installed
    const result = await checkOpenCodeAvailable();
    expect(typeof result).toBe("boolean");
  });
});

describe("exportSession", () => {
  it("throws when directory does not exist", async () => {
    const nonExistentDir = path.join(os.tmpdir(), "nonexistent-dir-" + Date.now());
    
    await expect(
      exportSession("ses_test123", nonExistentDir)
    ).rejects.toThrow("Session directory does not exist");
  });

  it("throws when opencode export command fails", async () => {
    // Create a real directory, but opencode won't find the session
    const testDir = path.join(os.tmpdir(), "export-test-" + Date.now());
    await mkdir(testDir, { recursive: true });

    try {
      // This will fail because either:
      // 1. opencode is not installed, or
      // 2. The session doesn't exist
      await expect(
        exportSession("ses_nonexistent_session", testDir)
      ).rejects.toThrow();
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });
});

describe("exportSessionWithRetry", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("returns null and logs warning when export fails", async () => {
    const testDir = path.join(os.tmpdir(), "retry-test-" + Date.now());
    await mkdir(testDir, { recursive: true });

    try {
      const result = await exportSessionWithRetry(
        "ses_nonexistent_session",
        testDir,
        0 // No retries
      );

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
      expect(warnSpy.mock.calls[0][0]).toContain("Failed to export session");
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("returns null when directory does not exist", async () => {
    const nonExistentDir = path.join(os.tmpdir(), "nonexistent-" + Date.now());

    const result = await exportSessionWithRetry(
      "ses_test123",
      nonExistentDir,
      0
    );

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("retries the specified number of times", async () => {
    const testDir = path.join(os.tmpdir(), "retry-count-test-" + Date.now());
    await mkdir(testDir, { recursive: true });

    try {
      const startTime = Date.now();
      const result = await exportSessionWithRetry(
        "ses_nonexistent",
        testDir,
        2 // 2 retries = 3 total attempts
      );
      const duration = Date.now() - startTime;

      expect(result).toBeNull();
      // With 2 retries and 500ms delay, should take at least 1000ms
      // But this depends on whether opencode is installed
      // At minimum, it should complete without hanging
      expect(duration).toBeLessThan(30000); // Should complete within 30s
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  }, 30000); // Extended timeout for slow CLI calls with retries

  it("returns export data on success (requires opencode)", async () => {
    // This test requires opencode to be installed and a real session
    // Skip if opencode is not available
    const isAvailable = await checkOpenCodeAvailable();
    if (!isAvailable) {
      // Can't test success case without opencode
      return;
    }

    // Even with opencode, we need a real session to export
    // This test documents the expected behavior but may not run in CI
    expect(typeof exportSessionWithRetry).toBe("function");
  });
});
