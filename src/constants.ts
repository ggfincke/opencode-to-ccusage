// src/constants.ts
// shared constants used across the codebase

import os from "node:os";
import path from "node:path";

// default directory for OpenCode exported data (mimics Claude Code config structure)
export const OPENCODE_CONFIG_DIR = path.join(os.homedir(), ".config", "claude-opencode");

// possible Claude Code data directories (ccusage checks these)
export const CLAUDE_CONFIG_PATHS = [
  path.join(os.homedir(), ".config", "claude"),
  path.join(os.homedir(), ".claude"),
];

// maximum buffer size for child process output (50MB)
export const MAX_BUFFER = 50 * 1024 * 1024;
