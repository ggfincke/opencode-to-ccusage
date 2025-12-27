// test/converter.test.ts
// tests for OpenCode export conversion to ccusage format

import { describe, it, expect } from "vitest";
import { convertSession, toJsonl } from "../src/converter.js";
import type { OpenCodeExport } from "../src/types.js";
import fixture from "./fixtures/sample-export.json";

// cast fixture to proper type
const sampleExport = fixture as OpenCodeExport;

describe("convertSession", () => {
  it("converts only assistant messages", () => {
    const result = convertSession(sampleExport, {
      includeReasoningInOutput: true,
    });
    expect(result.lines.length).toBe(5);
    for (const line of result.lines) {
      expect(line.message.id).toMatch(/^msg_assistant/);
    }
  });

  it("skips user messages", () => {
    const result = convertSession(sampleExport, {
      includeReasoningInOutput: true,
    });
    for (const line of result.lines) {
      expect(line.message.id).not.toMatch(/^msg_user/);
    }
  });

  it("skips messages with zero tokens", () => {
    const result = convertSession(sampleExport, {
      includeReasoningInOutput: true,
    });
    const ids = result.lines.map((l) => l.message.id);
    expect(ids).not.toContain("msg_assistant003_no_tokens");
    expect(result.skippedCount).toBeGreaterThanOrEqual(1);
  });

  it("includes reasoning in output_tokens when flag is true", () => {
    const result = convertSession(sampleExport, {
      includeReasoningInOutput: true,
    });
    const msg1 = result.lines.find(
      (l) => l.message.id === "msg_assistant001"
    );
    expect(msg1).toBeDefined();
    expect(msg1!.message.usage.output_tokens).toBe(250);

    const msg2 = result.lines.find(
      (l) => l.message.id === "msg_assistant002"
    );
    expect(msg2).toBeDefined();
    expect(msg2!.message.usage.output_tokens).toBe(400);
  });

  it("excludes reasoning from output_tokens when flag is false", () => {
    const result = convertSession(sampleExport, {
      includeReasoningInOutput: false,
    });
    const msg1 = result.lines.find(
      (l) => l.message.id === "msg_assistant001"
    );
    expect(msg1).toBeDefined();
    expect(msg1!.message.usage.output_tokens).toBe(200);

    const msg2 = result.lines.find(
      (l) => l.message.id === "msg_assistant002"
    );
    expect(msg2).toBeDefined();
    expect(msg2!.message.usage.output_tokens).toBe(300);
  });

  it("uses completed time for timestamp when available", () => {
    const result = convertSession(sampleExport, {
      includeReasoningInOutput: true,
    });
    const msg1 = result.lines.find(
      (l) => l.message.id === "msg_assistant001"
    );
    expect(msg1).toBeDefined();
    const expectedTimestamp = new Date(1766803204586).toISOString();
    expect(msg1!.timestamp).toBe(expectedTimestamp);
  });

  it("includes cache tokens when present", () => {
    const result = convertSession(sampleExport, {
      includeReasoningInOutput: true,
    });
    const msg1 = result.lines.find(
      (l) => l.message.id === "msg_assistant001"
    );
    expect(msg1).toBeDefined();
    expect(msg1!.message.usage.cache_read_input_tokens).toBe(1000);
    expect(msg1!.message.usage.cache_creation_input_tokens).toBe(500);
  });

  it("omits cache tokens when zero", () => {
    const result = convertSession(sampleExport, {
      includeReasoningInOutput: true,
    });
    const msg4 = result.lines.find(
      (l) => l.message.id === "msg_assistant004_no_cwd"
    );
    expect(msg4).toBeDefined();
    expect(msg4!.message.usage.cache_read_input_tokens).toBeUndefined();
    expect(msg4!.message.usage.cache_creation_input_tokens).toBeUndefined();
  });

  it("sets correct requestId format", () => {
    const result = convertSession(sampleExport, {
      includeReasoningInOutput: true,
    });
    const msg1 = result.lines.find(
      (l) => l.message.id === "msg_assistant001"
    );
    expect(msg1).toBeDefined();
    expect(msg1!.requestId).toBe(
      "opencode:ses_test123abc:msg_assistant001"
    );
  });

  it("includes cwd when available", () => {
    const result = convertSession(sampleExport, {
      includeReasoningInOutput: true,
    });
    const msg1 = result.lines.find(
      (l) => l.message.id === "msg_assistant001"
    );
    expect(msg1).toBeDefined();
    expect(msg1!.cwd).toBe("/Users/test/project");
  });

  it("omits cwd when not available", () => {
    const result = convertSession(sampleExport, {
      includeReasoningInOutput: true,
    });
    const msg4 = result.lines.find(
      (l) => l.message.id === "msg_assistant004_no_cwd"
    );
    expect(msg4).toBeDefined();
    expect(msg4!.cwd).toBeUndefined();
  });

  it("preserves model identifier as-is", () => {
    const result = convertSession(sampleExport, {
      includeReasoningInOutput: true,
    });
    const msg1 = result.lines.find(
      (l) => l.message.id === "msg_assistant001"
    );
    expect(msg1!.message.model).toBe("claude-opus-4-5");

    const msg2 = result.lines.find(
      (l) => l.message.id === "msg_assistant002"
    );
    expect(msg2!.message.model).toBe("claude-sonnet-4-20250514");
  });

  it("sorts output by timestamp ascending", () => {
    const result = convertSession(sampleExport, {
      includeReasoningInOutput: true,
    });
    const timestamps = result.lines.map((l) => l.timestamp);
    const sorted = [...timestamps].sort();
    expect(timestamps).toEqual(sorted);
  });

  it("sets sessionId on all lines", () => {
    const result = convertSession(sampleExport, {
      includeReasoningInOutput: true,
    });
    for (const line of result.lines) {
      expect(line.sessionId).toBe("ses_test123abc");
    }
  });

  it("deduplicates by messageId and timestamp", () => {
    const duplicateExport: OpenCodeExport = {
      info: sampleExport.info,
      messages: [
        sampleExport.messages[1],
        sampleExport.messages[1],
        sampleExport.messages[3],
      ],
    };

    const result = convertSession(duplicateExport, {
      includeReasoningInOutput: true,
    });
    expect(result.lines.length).toBe(2);
    expect(result.skippedCount).toBe(1);
  });

  it("uses 'unknown' when modelID is missing", () => {
    const exportWithMissingModel: OpenCodeExport = {
      info: sampleExport.info,
      messages: [
        {
          info: {
            id: "msg_no_model",
            sessionID: "ses_test123abc",
            role: "assistant",
            time: {
              created: 1766803109115,
              completed: 1766803204586,
            },
            providerID: "anthropic",
            cost: 0,
            tokens: {
              input: 100,
              output: 200,
              reasoning: 0,
              cache: {
                read: 0,
                write: 0,
              },
            },
          },
          parts: [],
        },
      ],
    };

    const result = convertSession(exportWithMissingModel, {
      includeReasoningInOutput: true,
    });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].message.model).toBe("unknown");
  });

  it("includes messages with only cache.write tokens (billable)", () => {
    const result = convertSession(sampleExport, {
      includeReasoningInOutput: true,
    });
    const cacheOnlyMsg = result.lines.find(
      (l) => l.message.id === "msg_assistant005_cache_only"
    );
    expect(cacheOnlyMsg).toBeDefined();
    expect(cacheOnlyMsg!.message.usage.input_tokens).toBe(0);
    expect(cacheOnlyMsg!.message.usage.output_tokens).toBe(0);
    expect(cacheOnlyMsg!.message.usage.cache_creation_input_tokens).toBe(15000);
  });

  it("includes messages with only reasoning tokens (billable)", () => {
    const result = convertSession(sampleExport, {
      includeReasoningInOutput: true,
    });
    const reasoningOnlyMsg = result.lines.find(
      (l) => l.message.id === "msg_assistant006_reasoning_only"
    );
    expect(reasoningOnlyMsg).toBeDefined();
    expect(reasoningOnlyMsg!.message.usage.input_tokens).toBe(0);
    expect(reasoningOnlyMsg!.message.usage.output_tokens).toBe(500);
  });

  it("handles reasoning-only message with --no-include-reasoning-in-output", () => {
    const result = convertSession(sampleExport, {
      includeReasoningInOutput: false,
    });
    const reasoningOnlyMsg = result.lines.find(
      (l) => l.message.id === "msg_assistant006_reasoning_only"
    );
    expect(reasoningOnlyMsg).toBeDefined();
    expect(reasoningOnlyMsg!.message.usage.output_tokens).toBe(0);
  });
});

describe("toJsonl", () => {
  it("returns empty string for empty array", () => {
    expect(toJsonl([])).toBe("");
  });

  it("produces valid JSONL format", () => {
    const result = convertSession(sampleExport, {
      includeReasoningInOutput: true,
    });
    const jsonl = toJsonl(result.lines);

    expect(jsonl.endsWith("\n")).toBe(true);

    const lines = jsonl.trim().split("\n");
    expect(lines.length).toBe(result.lines.length);

    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("produces deterministic output", () => {
    const result1 = convertSession(sampleExport, {
      includeReasoningInOutput: true,
    });
    const result2 = convertSession(sampleExport, {
      includeReasoningInOutput: true,
    });

    const jsonl1 = toJsonl(result1.lines);
    const jsonl2 = toJsonl(result2.lines);

    expect(jsonl1).toBe(jsonl2);
  });
});
