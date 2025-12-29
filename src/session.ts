// src/session.ts
// session discovery & export from OpenCode storage

import { readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  OpenCodeExportSchema,
  StoredSessionInfoSchema,
  type OpenCodeExport,
  type SessionListItem,
} from "./types.js";
import { execCommand, fileExists, getErrorMessage, warn } from "./utils.js";

// get OpenCode storage directory (override > env > platform default)
export function getStorageDir(override?: string): string {
  // explicit override
  if (override) {
    return path.join(override, "storage");
  }

  // environment variable
  const envDir = process.env.OPENCODE_DATA_DIR;
  if (envDir) {
    return path.join(envDir, "storage");
  }

  // platform-specific default
  const platform = os.platform();
  if (platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
    return path.join(localAppData, "opencode", "storage");
  } else {
    // OpenCode uses xdg-basedir which returns ~/.local/share on macOS (not ~/Library)
    const xdgDataHome = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
    return path.join(xdgDataHome, "opencode", "storage");
  }
}

// check if OpenCode CLI is available
export async function checkOpenCodeAvailable(): Promise<boolean> {
  try {
    const result = await execCommand("opencode", ["--version"]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

// * list all sessions by reading directly from OpenCode storage (parallelized)
export async function listSessions(
  since?: Date,
  openCodeDir?: string
): Promise<SessionListItem[]> {
  const storageDir = getStorageDir(openCodeDir);
  const sessionsDir = path.join(storageDir, "session");

  if (!(await fileExists(sessionsDir))) {
    return [];
  }

  try {
    // read all project directories under session/
    const projectDirs = await readdir(sessionsDir, { withFileTypes: true });
    const validProjectDirs = projectDirs.filter((d) => d.isDirectory());

    // process all project directories in parallel
    const projectResults = await Promise.all(
      validProjectDirs.map(async (projectDir) => {
        const projectPath = path.join(sessionsDir, projectDir.name);
        const sessionFiles = await readdir(projectPath);
        const jsonFiles = sessionFiles.filter((f) => f.endsWith(".json"));

        // read all session files in this project directory in parallel
        const sessionResults = await Promise.all(
          jsonFiles.map(async (sessionFile) => {
            try {
              const sessionPath = path.join(projectPath, sessionFile);
              const content = await readFile(sessionPath, "utf-8");
              const parsed = StoredSessionInfoSchema.safeParse(JSON.parse(content));

              if (!parsed.success) {
                return null;
              }

              const sessionInfo = parsed.data;
              return {
                id: sessionInfo.id,
                title: sessionInfo.title ?? "",
                updated: sessionInfo.time.updated,
                created: sessionInfo.time.created,
                projectId: sessionInfo.projectID,
                directory: sessionInfo.directory,
              } as SessionListItem;
            } catch {
              return null;
            }
          })
        );

        // filter out nulls (failed parses)
        return sessionResults.filter((s): s is SessionListItem => s !== null);
      })
    );

    // flatten all project results into single array
    const sessions = projectResults.flat();

    // filter by --since if provided
    let filteredSessions = sessions;
    if (since) {
      const sinceMs = since.getTime();
      filteredSessions = sessions.filter((s) => s.created >= sinceMs);
    }

    // sort by created time ascending (oldest first)
    filteredSessions.sort((a, b) => a.created - b.created);

    return filteredSessions;
  } catch (err) {
    throw new Error(`Failed to read sessions from storage: ${getErrorMessage(err)}`);
  }
}

// export single session using OpenCode CLI (must run from session directory)
export async function exportSession(
  sessionId: string,
  directory: string
): Promise<OpenCodeExport> {
  // verify directory exists
  if (!(await fileExists(directory))) {
    throw new Error(`Session directory does not exist: ${directory}`);
  }

  // use temp file to avoid stdout buffer issues w/ large exports
  const tmpFile = path.join(os.tmpdir(), `opencode-export-${sessionId}-${Date.now()}.json`);
  
  try {
    // export to temp file using shell redirection
    const result = await execCommand(
      "opencode",
      ["export", sessionId],
      directory,
      tmpFile
    );

    if (result.exitCode !== 0) {
      throw new Error(
        `opencode export ${sessionId} failed (exit ${result.exitCode}): ${result.stderr}`
      );
    }

    // read temp file
    const content = await readFile(tmpFile, "utf-8");
    
    // output may have prefix like "Exporting session: xxx" before JSON
    // find first '{' & parse from there
    let jsonStr = content;
    const jsonStart = jsonStr.indexOf("{");
    if (jsonStart === -1) {
      throw new Error(`No JSON found in export output for session ${sessionId}`);
    }
    if (jsonStart > 0) {
      jsonStr = jsonStr.slice(jsonStart);
    }

    const parsed = OpenCodeExportSchema.safeParse(JSON.parse(jsonStr));
    if (!parsed.success) {
      throw new Error(
        `Invalid export JSON for session ${sessionId}: ${parsed.error.message}`
      );
    }
    return parsed.data;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(
        `Failed to parse export JSON for session ${sessionId}: ${err}`
      );
    }
    throw err;
  } finally {
    // clean up temp file
    try {
      await unlink(tmpFile);
    } catch {
      // ignore cleanup errors
    }
  }
}

// export session w/ retry on failure
export async function exportSessionWithRetry(
  sessionId: string,
  directory: string,
  maxRetries = 1
): Promise<OpenCodeExport | null> {
  let lastError: Error | null = null;
  let lastStderr: string | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await exportSession(sessionId, directory);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // try to extract stderr from error message
      const stderrMatch = lastError.message.match(/stderr: (.+)/);
      if (stderrMatch) {
        lastStderr = stderrMatch[1];
      }
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  // build detailed error message
  let errorMsg = `Failed to export session ${sessionId}`;
  if (lastError?.message) {
    const msg = lastError.message.length > 200 
      ? lastError.message.slice(0, 200) + "..." 
      : lastError.message;
    errorMsg += `: ${msg}`;
  }
  if (lastStderr) {
    const stderr = lastStderr.length > 100 
      ? lastStderr.slice(0, 100) + "..." 
      : lastStderr;
    errorMsg += ` (stderr: ${stderr})`;
  }

  warn(errorMsg);
  return null;
}
