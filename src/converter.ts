// src/converter.ts
// convert OpenCode exports to ccusage-compatible JSONL format

import type { CcusageLine, OpenCodeExport, OpenCodeMessage } from "./types.js";
import { dedupeKey, toISOTimestamp } from "./utils.js";

export interface ConvertOptions {
  includeReasoningInOutput: boolean;
}

export interface ConvertResult {
  lines: CcusageLine[];
  skippedCount: number;
}

// check if message has valid token data (any billable activity)
function hasValidTokens(msg: OpenCodeMessage): boolean {
  const tokens = msg.info.tokens;
  if (!tokens) return false;
  
  // include if any token activity (input, output, reasoning, or cache)
  return (
    tokens.input > 0 ||
    tokens.output > 0 ||
    tokens.reasoning > 0 ||
    tokens.cache.read > 0 ||
    tokens.cache.write > 0
  );
}

// check if message has valid timestamp
function hasValidTimestamp(msg: OpenCodeMessage): boolean {
  return (
    msg.info.time.completed !== undefined || msg.info.time.created !== undefined
  );
}

// get best timestamp from message (prefer completed over created)
function getTimestamp(msg: OpenCodeMessage): number {
  return msg.info.time.completed ?? msg.info.time.created;
}

// convert OpenCode message to ccusage line
function convertMessage(
  msg: OpenCodeMessage,
  sessionId: string,
  options: ConvertOptions
): CcusageLine {
  const tokens = msg.info.tokens!;
  const timestamp = getTimestamp(msg);

  // calculate output tokens (optionally include reasoning)
  const outputTokens = options.includeReasoningInOutput
    ? tokens.output + tokens.reasoning
    : tokens.output;

  const line: CcusageLine = {
    timestamp: toISOTimestamp(timestamp),
    sessionId: sessionId,
    requestId: `opencode:${sessionId}:${msg.info.id}`,
    message: {
      id: msg.info.id,
      model: msg.info.modelID ?? "unknown",
      usage: {
        input_tokens: tokens.input,
        output_tokens: outputTokens,
      },
    },
  };

  // add optional fields
  if (msg.info.path?.cwd) {
    line.cwd = msg.info.path.cwd;
  }

  if (tokens.cache.read > 0) {
    line.message.usage.cache_read_input_tokens = tokens.cache.read;
  }

  if (tokens.cache.write > 0) {
    line.message.usage.cache_creation_input_tokens = tokens.cache.write;
  }

  return line;
}

// * convert OpenCode export to ccusage-compatible JSONL lines
export function convertSession(
  session: OpenCodeExport,
  options: ConvertOptions
): ConvertResult {
  const lines: CcusageLine[] = [];
  const seen = new Set<string>();
  let skippedCount = 0;

  for (const msg of session.messages) {
    // only include assistant messages (billable model calls)
    if (msg.info.role !== "assistant") {
      continue;
    }

    // skip if no valid tokens
    if (!hasValidTokens(msg)) {
      skippedCount++;
      continue;
    }

    // skip if no valid timestamp
    if (!hasValidTimestamp(msg)) {
      skippedCount++;
      continue;
    }

    // deduplicate by (messageId, timestamp)
    const key = dedupeKey(msg.info.id, getTimestamp(msg));
    if (seen.has(key)) {
      skippedCount++;
      continue;
    }
    seen.add(key);

    // convert & add
    const line = convertMessage(msg, session.info.id, options);
    lines.push(line);
  }

  // sort by timestamp ascending (deterministic ordering)
  lines.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return { lines, skippedCount };
}

// serialize ccusage lines to JSONL format
export function toJsonl(lines: CcusageLine[]): string {
  if (lines.length === 0) return "";
  // pre-allocate array for better memory allocation
  const parts = new Array<string>(lines.length);
  for (let i = 0; i < lines.length; i++) {
    parts[i] = JSON.stringify(lines[i]);
  }
  return parts.join("\n") + "\n";
}
