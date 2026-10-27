/**
 * RECALLOS learning engine.
 *
 * Lifecycle: PROPOSED -> SUPPORTED -> APPLIED -> REEVALUATED (or REJECTED).
 *
 * Evidence gates (server-enforced — a lesson can NEVER be promoted just
 * because an LLM produced it):
 *   - PROPOSED  : drafted from exactly one outcome evaluation (observationCount=1).
 *   - SUPPORTED : requires observationCount >= MIN_OBSERVATIONS (2), at least one
 *                 OUTCOME evidence item, and zero recorded contradictions.
 *   - APPLIED   : set by the ask/compare pipeline when this lesson demonstrably
 *                 influenced a later recommendation (lesson id referenced in the
 *                 answer trace).
 *   - REEVALUATED: an APPLIED lesson later contradicted by a new outcome.
 *
 * Confidence is computed from evidence counts — never taken from the LLM.
 */

import { db } from "@/lib/db";
import { parseJsonArray, parseJsonObject, evidenceRefSchema, type EvidenceRef } from "@/lib/validation";
import { aiJson } from "@/lib/ai/provider";
import { buildLessonDraftMessages, buildEvaluationMessages } from "@/lib/ai/prompts";
import { z } from "zod";
import { writeMemory } from "@/lib/memory/service";

export const LESSON_GATE = {
  MIN_OBSERVATIONS: 2,
  REQUIRE_OUTCOME_EVIDENCE: true,
  MAX_CONTRADICTIONS: 0,
} as const;

export function gateForPromotion(lesson: {
  observationCount: number;
  evidenceJson: string;
  status: string;
}): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (lesson.status !== "PROPOSED") reasons.push(`status must be PROPOSED (is ${lesson.status})`);
  if (lesson.observationCount < LESSON_GATE.MIN_OBSERVATIONS) {
    reasons.push(`needs >= ${LESSON_GATE.MIN_OBSERVATIONS} supporting observations (has ${lesson.observationCount})`);
  }
  const evidence = parseJsonArray(lesson.evidenceJson, evidenceRefSchema);
  if (LESSON_GATE.REQUIRE_OUTCOME_EVIDENCE && !evidence.some((e) => e.kind === "OUTCOME")) {
    reasons.push("requires at least one OUTCOME evidence item");
  }
  const contradictions = evidence.filter((e) => e.summary.startsWith("CONTRADICTION:"));
  if (contradictions.length > LESSON_GATE.MAX_CONTRADICTIONS) {
    reasons.push(`${contradictions.length} contradiction(s) recorded`);
  }
  return { pass: reasons.length === 0, reasons };
}

function confidenceFor(lesson: { status: string; observationCount: number }): "LOW" | "MEDIUM" | "HIGH" {
  if (lesson.status === "PROPOSED" || lesson.status === "REEVALUATED") return "LOW";
  if (lesson.observationCount >= 4) return "HIGH";
  if (lesson.observationCount >= LESSON_GATE.MIN_OBSERVATIONS) return "MEDIUM";
  return "LOW";
}

/* ------------------------------------------------------------------ */
/* Outcome evaluation                                                  */
/* ------------------------------------------------------------------ */

const evaluationSchema = z.object({
  verdicts: z.array(
    z.object({
      assumptionId: z.string(),
      verdict: z.enum(["HELD", "PARTIALLY_HELD", "NOT_HELD", "INCONCLUSIVE"]),
      rationale: z.string(),
    }),
  ),
  overallVerdict: z.enum(["HELD", "PARTIALLY_HELD", "NOT_HELD", "INCONCLUSIVE"]),
  summary: z.string(),
});

const lessonDraftSchema = z.object({
  statement: z.string(),
  category: z.string(),
  exceptions: z.array(z.string()).default([]),
  tentative: z.boolean().default(true),
});

const relationSchema = z.object({
  assessments: z.array(
    z.object({
      lessonId: z.string(),
      relation: z.enum(["SUPPORTS", "CONTRADICTS", "UNRELATED"]),
      why: z.string(),
    }),
  ),
});

export type EvaluationResult = {
  decisionId: string;
  overallVerdict: string;
  verdicts: Array<{ assumptionId: string; verdict: string; rationale: string }>;
  summary: string;
  lessonId: string | null;
  lessonStatement: string | null;
  lessonTentative: boolean;
  aiUnavailable: boolean;
};

/**
 * Records the actual outcome for a decision, evaluates every assumption
 * (AI-assisted, with explicit INCONCLUSIVE handling), stores evidence, drafts
 * at most one PROPOSED lesson, and cross-assesses existing open lessons in the
 * same category (SUPPORTS / CONTRADICTS) — the mechanism that grows or
 * disconfirms lessons over time.
 */
export async function evaluateDecisionOutcome(args: {
  userId: string;
  decisionId: string;
  actualOutcome: string;
  evidenceSummary?: string;
}): Promise<EvaluationResult> {
  const decision = await db.decision.findFirst({
    where: { id: args.decisionId, userId: args.userId },
  });
  if (!decision) throw new Error("DECISION_NOT_FOUND");

  const assumptions = parseJsonArray(decision.assumptionsJson, z.object({ id: z.string(), text: z.string() }));
  const priorEvidence = parseJsonArray(decision.evidenceRefsJson, evidenceRefSchema);

  // OUTCOME evidence is always recorded, even if AI evaluation then fails —
  // the fact itself must not be lost.
  const outcomeEvidence: EvidenceRef = {
    kind: "OUTCOME",
    sourceRef: `decision:${decision.id}`,
    summary: args.evidenceSummary?.trim()
      ? `OUTCOME: ${args.evidenceSummary.trim()}`
      : `OUTCOME (user-reported): ${args.actualOutcome.slice(0, 300)}`,
  };
  const allEvidence = [...priorEvidence, outcomeEvidence];

  await db.evidenceItem.create({
    data: {
      decisionId: decision.id,
      kind: "OUTCOME",
      sourceRef: `decision:${decision.id}`,
      summary: outcomeEvidence.summary,
      payloadJson: JSON.stringify({ actualOutcome: args.actualOutcome, provided: args.evidenceSummary ?? null }),
    },
  });

  let verdicts: Array<{ assumptionId: string; verdict: string; rationale: string }> = [];
  let overallVerdict = "INCONCLUSIVE";
  let summary = "";
  let aiUnavailable = false;

  try {
    const evaluation = await aiJson(
      buildEvaluationMessages({
        decisionBlock: [
          "<<<DECISION RECORD>>>",
          JSON.stringify(
            {
              question: decision.question,
              goal: decision.goal,
              assumptions,
              recommendation: decision.recommendation,
              expectedOutcome: decision.expectedOutcome,
              evaluationCriteria: decision.evaluationCriteria,
            },
            null,
            1,
          ),
        ].join("\n"),
        outcomeBlock: `<<<REPORTED OUTCOME (user-reported, may be incomplete)>>>\n${args.actualOutcome}`,
        evidenceBlock: `<<<EVIDENCE ON RECORD>>>${allEvidence.length ? "" : " (none beyond the outcome itself)"}
${allEvidence.map((e) => `- [${e.kind}] ${e.summary}`).join("\n")}`,
      }),
      evaluationSchema,
    );
    verdicts = evaluation.verdicts;
    overallVerdict = evaluation.overallVerdict;
    summary = evaluation.summary;
  } catch (err) {
    aiUnavailable = true;
    console.warn("[learning] AI evaluation unavailable:", (err as Error).message);
    // Honest fallback: mark every assumption INCONCLUSIVE with the reason.
    verdicts = assumptions.map((a) => ({
      assumptionId: a.id,
      verdict: "INCONCLUSIVE" as const,
      rationale: "AI evaluation unavailable at evaluation time; outcome recorded but assumptions not adjudicated.",
    }));
    summary = "Outcome recorded. Automatic assumption adjudication unavailable — review manually.";
  }

  await db.decision.update({
    where: { id: decision.id },
    data: {
      actualOutcome: args.actualOutcome,
      verdictsJson: JSON.stringify(verdicts),
      overallVerdict,
      evaluatedAt: new Date(),
      status: "EVALUATED",
      evidenceRefsJson: JSON.stringify(allEvidence),
    },
  });

  // ---- Draft a lesson (single prediction => tentative, PROPOSED, LOW) ----
  let lessonId: string | null = null;
  let lessonStatement: string | null = null;
  let lessonTentative = true;

  try {
    const draft = await aiJson(
      buildLessonDraftMessages({
        evaluationBlock: JSON.stringify(
          {
            decision: { question: decision.question, category: decision.category, goal: decision.goal },
            verdicts,
            overallVerdict,
            summary,
          },
          null,
          1,
        ),
      }),
      lessonDraftSchema,
    );
    lessonTentative = draft.tentative ?? true;
    const created = await db.lesson.create({
      data: {
        statement: draft.statement,
        category: decision.category,
        supportingDecisionsJson: JSON.stringify([decision.id]),
        evidenceJson: JSON.stringify([{ kind: "OUTCOME", sourceRef: `decision:${decision.id}`, summary: summary.slice(0, 300) }]),
        observationCount: 1,
        confidence: "LOW",
        status: "PROPOSED",
        exceptionsJson: JSON.stringify(draft.exceptions ?? []),
      },
    });
    lessonId = created.id;
    lessonStatement = created.statement;
  } catch (err) {
    console.warn("[learning] lesson drafting unavailable:", (err as Error).message);
  }

  // ---- Cross-assess open lessons in the same category ----
  await crossAssessLessons({
    userId: args.userId,
    category: decision.category,
    decisionId: decision.id,
    evaluationBlock: JSON.stringify({ verdicts, overallVerdict, summary }),
  });

  // ---- Persist an outcome memory (goes through the write policy) ----
  await writeMemory({
    userId: args.userId,
    category: "DECISION_SUMMARY",
    content: `Outcome of "${decision.title}": ${args.actualOutcome.slice(0, 400)} (verdict: ${overallVerdict})`,
    importance: 4,
    tags: ["outcome", decision.category.toLowerCase()],
    decisionId: decision.id,
  });

  return {
    decisionId: decision.id,
    overallVerdict,
    verdicts,
    summary,
    lessonId,
    lessonStatement,
    lessonTentative,
    aiUnavailable,
  };
}

/** Batched support/contradict assessment of open lessons against a new evaluation. */
async function crossAssessLessons(args: {
  userId: string;
  category: string;
  decisionId: string;
  evaluationBlock: string;
}): Promise<void> {
  const open = await db.lesson.findMany({
    where: { category: args.category, status: { in: ["PROPOSED", "SUPPORTED"] } },
  });
  if (open.length === 0) return;
  try {
    const { aiChat } = await import("@/lib/ai/provider");
    const result = await aiJson(
      [
        {
          role: "system",
          content: [
            "You assess whether a new decision outcome SUPPORTS, CONTRADICTS, or is UNRELATED to each candidate lesson.",
            "Be strict: CONTRADICTS only when the outcome actively disconfirms the lesson; UNRELATED when the topic differs.",
            "Answer schema:",
            '{"assessments": [{"lessonId": string, "relation": "SUPPORTS"|"CONTRADICTS"|"UNRELATED", "why": string}]}',
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            "LESSONS:",
            ...open.map((l) => `- id=${l.id}: ${l.statement}`),
            "",
            args.evaluationBlock,
          ].join("\n"),
        },
      ],
      relationSchema,
    );
    for (const a of result.assessments) {
      const lesson = open.find((l) => l.id === a.lessonId);
      if (!lesson || a.relation === "UNRELATED") continue;
      const evidence = parseJsonArray(lesson.evidenceJson, evidenceRefSchema);
      if (a.relation === "SUPPORTS") {
        const supporting = parseJsonArray(lesson.supportingDecisionsJson, z.string());
        const updated = {
          observationCount: lesson.observationCount + 1,
          supportingDecisionsJson: JSON.stringify([...supporting, args.decisionId]),
          evidenceJson: JSON.stringify([...evidence, { kind: "OUTCOME", sourceRef: `decision:${args.decisionId}`, summary: a.why.slice(0, 300) }]),
        };
        // Auto-promote when the gate passes for a PROPOSED lesson (server-side gate, not LLM whim).
        const gate = gateForPromotion({ ...lesson, ...updated, observationCount: updated.observationCount });
        await db.lesson.update({
          where: { id: lesson.id },
          data: {
            ...updated,
            status: gate.pass ? "SUPPORTED" : lesson.status,
            confidence: confidenceFor({ status: gate.pass ? "SUPPORTED" : lesson.status, observationCount: updated.observationCount }),
          },
        });
      } else {
        // CONTRADICTS: record it; demote APPLIED lessons to REEVALUATED.
        await db.lesson.update({
          where: { id: lesson.id },
          data: {
            evidenceJson: JSON.stringify([
              ...evidence,
              { kind: "OUTCOME", sourceRef: `decision:${args.decisionId}`, summary: `CONTRADICTION: ${a.why.slice(0, 280)}` },
            ]),
            status: lesson.status === "APPLIED" ? "REEVALUATED" : lesson.status,
            reevaluatedAt: lesson.status === "APPLIED" ? new Date() : lesson.reevaluatedAt,
            confidence: "LOW",
          },
        });
      }
    }
  } catch (err) {
    console.warn("[learning] cross-assessment unavailable:", (err as Error).message);
  }
}

/* ------------------------------------------------------------------ */
/* Lesson actions                                                      */
/* ------------------------------------------------------------------ */

export async function promoteLesson(lessonId: string): Promise<{ ok: boolean; reasons: string[] }> {
  const lesson = await db.lesson.findUnique({ where: { id: lessonId } });
  if (!lesson) throw new Error("LESSON_NOT_FOUND");
  const gate = gateForPromotion(lesson);
  if (!gate.pass) return { ok: false, reasons: gate.reasons };
  await db.lesson.update({
    where: { id: lessonId },
    data: { status: "SUPPORTED", confidence: confidenceFor({ status: "SUPPORTED", observationCount: lesson.observationCount }) },
  });
  return { ok: true, reasons: [] };
}

export async function markLessonApplied(lessonId: string): Promise<void> {
  await db.lesson.update({
    where: { id: lessonId },
    data: { status: "APPLIED", appliedAt: new Date() },
  });
}

export async function rejectLesson(lessonId: string): Promise<void> {
  await db.lesson.update({ where: { id: lessonId }, data: { status: "REJECTED", confidence: "LOW" } });
}
