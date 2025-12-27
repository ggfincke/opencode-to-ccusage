// src/types.ts
// type definitions & zod schemas for OpenCode exports & ccusage output

import { z } from "zod";

// opencode storage schemas (internal session files)

export const StoredSessionInfoSchema = z.object({
  id: z.string(),
  projectID: z.string(),
  directory: z.string(),
  title: z.string().optional().default(""),
  time: z.object({
    created: z.number(),
    updated: z.number(),
  }),
});
export type StoredSessionInfo = z.infer<typeof StoredSessionInfoSchema>;

// opencode export schemas (from `opencode export`)

export const TokenInfoSchema = z.object({
  input: z.number(),
  output: z.number(),
  reasoning: z.number(),
  cache: z.object({
    read: z.number(),
    write: z.number(),
  }),
});
export type TokenInfo = z.infer<typeof TokenInfoSchema>;

export const MessageInfoSchema = z.object({
  id: z.string(),
  sessionID: z.string(),
  role: z.enum(["user", "assistant"]),
  time: z.object({
    created: z.number(),
    completed: z.number().optional(),
  }),
  modelID: z.string().optional(),
  providerID: z.string().optional(),
  cost: z.number().optional(),
  tokens: TokenInfoSchema.optional(),
  path: z.object({
    cwd: z.string(),
    root: z.string(),
  }).optional(),
});
export type MessageInfo = z.infer<typeof MessageInfoSchema>;

export const OpenCodeMessageSchema = z.object({
  info: MessageInfoSchema,
  parts: z.array(z.unknown()), // Not needed for conversion
});
export type OpenCodeMessage = z.infer<typeof OpenCodeMessageSchema>;

export const SessionInfoSchema = z.object({
  id: z.string(),
  version: z.string(),
  projectID: z.string(),
  directory: z.string(),
  title: z.string(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
  }),
  summary: z.object({
    additions: z.number(),
    deletions: z.number(),
    files: z.number(),
  }).optional(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

export const OpenCodeExportSchema = z.object({
  info: SessionInfoSchema,
  messages: z.array(OpenCodeMessageSchema),
});
export type OpenCodeExport = z.infer<typeof OpenCodeExportSchema>;

// session list item (derived from stored session info)

export interface SessionListItem {
  id: string;
  title: string;
  updated: number;
  created: number;
  projectId: string;
  directory: string;
}

// ccusage output schemas (from `npx ccusage --json`)

export const ModelBreakdownSchema = z.object({
  modelName: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheCreationTokens: z.number(),
  cacheReadTokens: z.number(),
  cost: z.number(),
});
export type ModelBreakdown = z.infer<typeof ModelBreakdownSchema>;

export const DailyEntrySchema = z.object({
  date: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheCreationTokens: z.number(),
  cacheReadTokens: z.number(),
  totalTokens: z.number(),
  totalCost: z.number(),
  modelsUsed: z.array(z.string()),
  modelBreakdowns: z.array(ModelBreakdownSchema),
  source: z.string().optional(),
});
export type DailyEntry = z.infer<typeof DailyEntrySchema>;

export const TotalsSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheCreationTokens: z.number(),
  cacheReadTokens: z.number(),
  totalTokens: z.number(),
  totalCost: z.number(),
});
export type Totals = z.infer<typeof TotalsSchema>;

export const CcusageDailyOutputSchema = z.object({
  daily: z.array(DailyEntrySchema),
  totals: TotalsSchema,
});
export type CcusageDailyOutput = z.infer<typeof CcusageDailyOutputSchema>;

export interface MergedDailyOutput {
  daily: DailyEntry[];
  totals: Totals;
  sources: string[];
}

// ccusage-compatible JSONL output format

export interface CcusageLine {
  timestamp: string;
  sessionId: string;
  cwd?: string;
  requestId: string;
  costUSD?: number;
  message: {
    id: string;
    model: string;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

// export configuration types

export type GroupBy = "flat" | "project" | "directory";

export interface ExportOptions {
  outDir: string;
  overwrite: boolean;
  since?: Date;
  includeReasoningInOutput: boolean;
  dryRun: boolean;
  verbose: boolean;
  groupBy: GroupBy;
  openCodeDir?: string;
}

export interface ExportStats {
  sessionsDiscovered: number;
  sessionsExported: number;
  sessionsSkipped: number;
  messagesConverted: number;
  messagesSkipped: number;
  errors: string[];
}
