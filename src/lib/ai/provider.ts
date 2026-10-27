/**
 * AI provider — server-side only. Wraps z-ai-web-dev-sdk behind a typed,
 * JSON-validated interface so every model output is schema-checked before use.
 */

import ZAI from "z-ai-web-dev-sdk";
import type { ZodType } from "zod";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export class AIUnavailableError extends Error {
  constructor(detail: string) {
    super(`AI provider unavailable: ${detail}`);
  }
}

let zaiInstance: Awaited<ReturnType<typeof ZAI.create>> | null | undefined;

async function getZai() {
  if (zaiInstance !== undefined) return zaiInstance;
  try {
    zaiInstance = await ZAI.create();
  } catch (err) {
    zaiInstance = null;
    console.warn("[ai] ZAI.create failed:", (err as Error).message);
  }
  return zaiInstance;
}

export async function aiChat(messages: ChatMessage[]): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const zai = await getZai();
    if (!zai) throw new AIUnavailableError("sdk init failed");
    try {
      const completion = await zai.chat.completions.create({ messages });
      const content = completion.choices?.[0]?.message?.content;
      if (!content) throw new AIUnavailableError("empty completion");
      return content;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Transient provider failures: one short backoff retry.
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
    }
  }
  throw lastError ?? new AIUnavailableError("unknown failure");
}

/** Extract the outermost JSON object from a model response. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("no JSON object found");
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Ask the model for JSON matching `schema`. One validation-retry with the
 * validation errors fed back; then throws. Callers must handle failure honestly.
 */
export async function aiJson<T>(messages: ChatMessage[], schema: ZodType<T>): Promise<T> {
  const first = await aiChat(messages);
  try {
    return schema.parse(extractJson(first));
  } catch (err) {
    const retry = await aiChat([
      ...messages,
      { role: "assistant", content: first.slice(0, 4000) },
      {
        role: "user",
        content: `Your previous JSON was invalid (${err instanceof Error ? err.message.slice(0, 400) : "parse error"}). Respond again with ONLY a corrected JSON object. No prose, no markdown fences.`,
      },
    ]);
    return schema.parse(extractJson(retry));
  }
}
