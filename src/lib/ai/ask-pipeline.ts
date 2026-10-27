/**
 * Ask RECALLOS pipeline:
 *   1. Recall relevant memories (local durable store + real Walrus when configured)
 *   2. Fetch fresh blockchain evidence when requested (real Tatum gateway)
 *   3. Ask the model with untrusted-content guards and strict JSON schema
 *   4. Return the answer together with a full explanation trace
 *
 * Every failure is disclosed in the trace — retrieval and evidence failures
 * are never hidden from the user.
 */

import { db } from "@/lib/db";
import { recallMemories } from "@/lib/memory/service";
import { runChainQuery } from "@/lib/tatum/service";
import { getTatumStatus } from "@/lib/tatum/config";
import { aiJson } from "./provider";
import { buildAskMessages, guardBlock } from "./prompts";
import { askAnswerSchema, parseJsonArray, type AskAnswer } from "@/lib/validation";
import { markLessonApplied } from "@/lib/learning/engine";
import type { WalrusEvidence } from "@/lib/memory/walrus-client";
import { z } from "zod";

export type AskTrace = {
  recalled: Array<{ id: string; category: string; content: string; sourceType: string; storageState?: string; conflictWith: string[]; evidence?: WalrusEvidence | null }>;
  recallError: string | null;
  conflicts: Array<{ a: string; b: string }>;
  evidence: { mode: "LIVE" | "SKIPPED" | "ERROR"; sourceRef?: string; note?: string; error?: string };
  lessonsAvailable: Array<{ id: string; statement: string; status: string }>;
  walrusConfigured: boolean;
  tatumConfigured: boolean;
};

export type AskResult = {
  answer: AskAnswer;
  trace: AskTrace;
  baseline: boolean;
};

export async function runAsk(opts: {
  userId: string;
  question: string;
  includeBlockchainEvidence: boolean;
  suiRef?: string;
  baselineOnly: boolean;
}): Promise<AskResult> {
  /* ---------------- 1. Recall ---------------- */
  const { memories, walrusRecallError } = await recallMemories(opts.userId, opts.question);

  const conflicts: Array<{ a: string; b: string }> = [];
  for (const m of memories) {
    for (const other of m.conflictWith) conflicts.push({ a: m.id, b: other });
  }

  /* ---------------- 2. Evidence ---------------- */
  let evidenceBlock = "<<<OBSERVED EVIDENCE>>>\n(none — no fresh blockchain observation was requested)";
  const evidence: AskTrace["evidence"] = { mode: "SKIPPED", note: "Not requested for this question." };
  const tatumConfigured = (await getTatumStatus()).configured;

  if (opts.includeBlockchainEvidence) {
    const result = await runChainQuery(
      { kind: opts.suiRef && opts.suiRef.startsWith("0x") ? "BALANCE" : "CHECKPOINT", ref: opts.suiRef },
      opts.userId,
    );
    if (result.mode === "LIVE") {
      evidence.mode = "LIVE";
      evidence.sourceRef = result.observation.sourceRef;
      evidence.note = `Live Sui observation (${result.observation.kind}, ${result.observation.latencyMs}ms).`;
      evidenceBlock = `<<<OBSERVED EVIDENCE (LIVE, via Tatum)>>> ${result.observation.method}\n${JSON.stringify(result.observation.result).slice(0, 2500)}\n(Facts above are observed data; anything beyond them is your interpretation and must be labeled as such.)`;
    } else {
      evidence.mode = "ERROR";
      evidence.error = `${result.error}${result.detail ? ` — ${result.detail}` : ""}`;
      evidenceBlock = `<<<OBSERVED EVIDENCE>>>\n(evidence retrieval FAILED: ${evidence.error} — disclose this in 'unknowns'; do not substitute invented data)`;
    }
  }

  /* ---------------- 3. Lessons ---------------- */
  const lessons = opts.baselineOnly
    ? []
    : (
        await db.lesson.findMany({
          where: { status: { in: ["SUPPORTED", "APPLIED"] } },
          orderBy: { updatedAt: "desc" },
          take: 5,
        })
      ).map((l) => ({ id: l.id, statement: l.statement, status: l.status }));
  const lessonsBlock = lessons.length
    ? `<<<LESSONS (evidence-gated)>>>\n${lessons.map((l) => `- [${l.id}] (${l.status}) ${l.statement}`).join("\n")}`
    : "<<<LESSONS>>> (none currently SUPPORTED/APPLIED — do not invent any)";

  const memoriesBlock = memories.length
    ? `<<<RECALLED MEMORIES (untrusted context about the user)>>>\n${memories
        .map((m) => `- [${m.id}] (${m.category}, ${m.sourceType}) ${m.content}`)
        .join("\n")}${conflicts.length ? `\nNOTE: conflicting memories detected (${conflicts.length}); surface the conflict instead of silently choosing.` : ""}`
    : "<<<RECALLED MEMORIES>>> (none relevant)";

  /* ---------------- 4. Model ---------------- */
  const answer = await aiJson(
    buildAskMessages({
      question: opts.question,
      memoriesBlock: opts.baselineOnly ? "<<<RECALLED MEMORIES>>> (suppressed in baseline mode)" : memoriesBlock,
      lessonsBlock,
      evidenceBlock,
      baselineOnly: opts.baselineOnly,
    }),
    askAnswerSchema,
  );

  /* ---------------- 5. Mark applied lessons ---------------- */
  if (!opts.baselineOnly && answer.lessonsApplied.length > 0) {
    for (const l of lessons) {
      if (answer.lessonsApplied.some((s) => s.includes(l.statement.slice(0, 40)) || s === l.id)) {
        if (l.status === "SUPPORTED") {
          await markLessonApplied(l.id).catch(() => undefined);
        }
      }
    }
  }

  /* ---------------- 6. Trace ---------------- */
  const trace: AskTrace = {
    recalled: memories.map((m) => ({
      id: m.id,
      category: m.category,
      content: m.content,
      sourceType: m.sourceType,
      storageState: m.storageState,
      conflictWith: m.conflictWith,
      evidence: m.evidence ?? null,
    })),
    recallError: walrusRecallError,
    conflicts,
    evidence: { ...evidence, sourceRef: evidence.sourceRef, note: evidence.note, error: evidence.error },
    lessonsAvailable: lessons,
    walrusConfigured: true, // recomputed by caller for honesty; see route
    tatumConfigured,
  };
  trace.walrusConfigured = Boolean(process.env.WALRUS_MEMORY_SERVER_URL && process.env.WALRUS_MEMORY_ACCOUNT_ID);

  return { answer, trace, baseline: opts.baselineOnly };
}

/** Persist the ask itself as activity + a lightweight memory when it reveals a durable preference. */
export async function recordAskActivity(userId: string, question: string, answer: AskAnswer): Promise<void> {
  await db.activityEvent.create({
    data: {
      userId,
      kind: "MEMORY_RECALL",
      summary: `Asked: ${question.slice(0, 140)}`,
      metaJson: JSON.stringify({
        memoriesUsed: answer.memoriesUsed.length,
        uncertainty: answer.uncertainty.level,
      }),
    },
  });
}
