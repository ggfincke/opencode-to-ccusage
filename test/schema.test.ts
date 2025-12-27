// test/schema.test.ts
// tests for schema validation & type safety

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { convertSession } from "../src/converter.js";
import type { OpenCodeExport } from "../src/types.js";
import fixture from "./fixtures/sample-export.json";

// Cast fixture to proper type
const sampleExport = fixture as OpenCodeExport;

/**
 * ccusage schema - based on ccusage/apps/ccusage/src/data-loader.ts
 * This validates that our output is compatible with ccusage
 */
const ccusageSchema = z.object({
  // Required fields
  timestamp: z.string().refine(
    (val) => {
      // Must be valid ISO 8601 format
      const date = new Date(val);
      return !isNaN(date.getTime());
    },
    { message: "timestamp must be valid ISO 8601" }
  ),

  // Optional fields from ccusage schema
  sessionId: z.string().min(1).optional(),
  cwd: z.string().optional(),
  requestId: z.string().optional(),
  costUSD: z.number().optional(),
  version: z.string().optional(),
  isApiErrorMessage: z.boolean().optional(),

  // Message object (required)
  message: z.object({
    id: z.string().optional(),
    model: z.string().optional(),
    content: z
      .array(
        z.object({
          text: z.string().optional(),
        })
      )
      .optional(),
    usage: z.object({
      input_tokens: z.number(),
      output_tokens: z.number(),
      cache_creation_input_tokens: z.number().optional(),
      cache_read_input_tokens: z.number().optional(),
    }),
  }),
});

describe("ccusage schema compliance", () => {
  it("all converted lines conform to ccusage schema", () => {
    const result = convertSession(sampleExport, {
      includeReasoningInOutput: true,
    });

    expect(result.lines.length).toBeGreaterThan(0);

    for (const line of result.lines) {
      const parseResult = ccusageSchema.safeParse(line);
      if (!parseResult.success) {
        console.error("Schema validation failed for line:", line);
        console.error("Errors:", parseResult.error.errors);
      }
      expect(parseResult.success).toBe(true);
    }
  });

  it("timestamps are valid ISO 8601 strings", () => {
    const result = convertSession(sampleExport, {
      includeReasoningInOutput: true,
    });

    for (const line of result.lines) {
      // Should match ISO 8601 pattern
      expect(line.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
      );

      // Should be parseable as a Date
      const date = new Date(line.timestamp);
      expect(isNaN(date.getTime())).toBe(false);
    }
  });

  it("input_tokens and output_tokens are non-negative numbers", () => {
    const result = convertSession(sampleExport, {
      includeReasoningInOutput: true,
    });

    for (const line of result.lines) {
      expect(typeof line.message.usage.input_tokens).toBe("number");
      expect(typeof line.message.usage.output_tokens).toBe("number");
      expect(line.message.usage.input_tokens).toBeGreaterThanOrEqual(0);
      expect(line.message.usage.output_tokens).toBeGreaterThanOrEqual(0);
    }
  });

  it("cache tokens are numbers when present", () => {
    const result = convertSession(sampleExport, {
      includeReasoningInOutput: true,
    });

    for (const line of result.lines) {
      const usage = line.message.usage;
      if (usage.cache_read_input_tokens !== undefined) {
        expect(typeof usage.cache_read_input_tokens).toBe("number");
        expect(usage.cache_read_input_tokens).toBeGreaterThanOrEqual(0);
      }
      if (usage.cache_creation_input_tokens !== undefined) {
        expect(typeof usage.cache_creation_input_tokens).toBe("number");
        expect(usage.cache_creation_input_tokens).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("sessionId is a non-empty string", () => {
    const result = convertSession(sampleExport, {
      includeReasoningInOutput: true,
    });

    for (const line of result.lines) {
      expect(typeof line.sessionId).toBe("string");
      expect(line.sessionId.length).toBeGreaterThan(0);
    }
  });

  it("requestId follows expected format", () => {
    const result = convertSession(sampleExport, {
      includeReasoningInOutput: true,
    });

    for (const line of result.lines) {
      expect(line.requestId).toMatch(/^opencode:[^:]+:[^:]+$/);
    }
  });

  it("model is a string when present", () => {
    const result = convertSession(sampleExport, {
      includeReasoningInOutput: true,
    });

    for (const line of result.lines) {
      expect(typeof line.message.model).toBe("string");
      expect(line.message.model.length).toBeGreaterThan(0);
    }
  });
});

describe("timestamp ordering", () => {
  it("timestamps are in ascending order", () => {
    const result = convertSession(sampleExport, {
      includeReasoningInOutput: true,
    });

    const timestamps = result.lines.map((l) => new Date(l.timestamp).getTime());

    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  });
});
