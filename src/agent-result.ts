import { z } from "zod";
import type { AgentResult } from "./types.js";

const resultSchema = z.object({
  reply: z.string().optional(),
  labels: z.array(z.string()).optional(),
  review: z.object({
    body: z.string(),
    event: z.enum(["COMMENT", "REQUEST_CHANGES", "APPROVE"]),
    comments: z.array(z.object({
      path: z.string(),
      line: z.number().int().positive(),
      body: z.string(),
      side: z.enum(["LEFT", "RIGHT"]).optional()
    })).optional()
  }).optional()
});

export function parseAgentResult(output: string): AgentResult {
  const candidates = [output.trim()];
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) candidates.unshift(fenced.trim());
  const marker = output.lastIndexOf("PI_RESULT:");
  if (marker >= 0) candidates.unshift(output.slice(marker + "PI_RESULT:".length).trim());

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      const result = resultSchema.safeParse(parsed);
      if (result.success) return result.data;
    } catch {
      // Try the next known output shape before treating the result as plain text.
    }
  }
  return { reply: output.trim() || "The agent returned no response." };
}
