import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Shared enum-ish unions                                              */
/* ------------------------------------------------------------------ */

export const MEMORY_CATEGORIES = [
  "PREFERENCE",
  "GOAL",
  "DECISION_SUMMARY",
  "LESSON",
  "EVIDENCE_PATTERN",
  "CONSTRAINT",
  "CORRECTION",
] as const;

export const MEMORY_SOURCE_TYPES = [
  "WALRUS", // confirmed by the real Walrus Memory integration
  "LOCAL_MIRROR", // durable local copy; pending Walrus sync (not mainnet-verified)
  "USER_INPUT",
] as const;

export const MEMORY_STORAGE_STATES = ["VERIFIED", "PENDING_SYNC", "FAILED"] as const;

export const LESSON_STATUSES = [
  "PROPOSED",
  "SUPPORTED",
  "APPLIED",
  "REEVALUATED",
  "REJECTED",
] as const;

export const OUTCOME_VERDICTS = ["HELD", "PARTIALLY_HELD", "NOT_HELD", "INCONCLUSIVE"] as const;

export const DECISION_CATEGORIES = [
  "INVESTMENT",
  "DEV_TOOLING",
  "SECURITY",
  "LIFESTYLE",
  "RESEARCH",
  "OTHER",
] as const;

export const EVIDENCE_KINDS = ["BLOCKCHAIN", "WEB", "USER", "MEMORY", "OUTCOME"] as const;

/* ------------------------------------------------------------------ */
/* Structured JSON shapes (stored as JSON strings in SQLite)           */
/* ------------------------------------------------------------------ */

export const assumptionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
});
export type Assumption = z.infer<typeof assumptionSchema>;

export const evidenceRefSchema = z.object({
  kind: z.enum(EVIDENCE_KINDS),
  sourceRef: z.string().nullish(),
  summary: z.string().min(1),
});
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

/** Single constraint line — exported so API routes can parse stored arrays
 *  without reaching into `.shape.x.element` of a defaulted array schema. */
export const constraintTextSchema = z.string().min(1).max(300);

export const assumptionVerdictSchema = z.object({
  assumptionId: z.string().min(1),
  verdict: z.enum(OUTCOME_VERDICTS),
  rationale: z.string().min(1),
});
export type AssumptionVerdict = z.infer<typeof assumptionVerdictSchema>;

/* ------------------------------------------------------------------ */
/* Decision input                                                      */
/* ------------------------------------------------------------------ */

export const decisionInputSchema = z.object({
  category: z.enum(DECISION_CATEGORIES),
  title: z.string().min(4).max(120),
  question: z.string().min(8).max(2000),
  goal: z.string().min(4).max(1000),
  constraints: z.array(constraintTextSchema).max(12).default([]),
  assumptions: z.array(assumptionSchema).max(12),
  evidenceRefs: z.array(evidenceRefSchema).max(20).default([]),
  recommendation: z.string().min(4).max(4000),
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
  expectedOutcome: z.string().min(4).max(2000),
  evaluationCriteria: z.string().min(4).max(2000),
  reviewDate: z.string().datetime().nullish(),
});
export type DecisionInput = z.infer<typeof decisionInputSchema>;

export const evaluateDecisionInputSchema = z.object({
  decisionId: z.string().min(1),
  actualOutcome: z.string().min(4).max(4000),
  evidenceSummary: z.string().max(2000).optional(),
});

/* ------------------------------------------------------------------ */
/* Ask RECALLOS                                                        */
/* ------------------------------------------------------------------ */

export const askInputSchema = z.object({
  question: z.string().min(4).max(2000),
  includeBlockchainEvidence: z.boolean().default(false),
  suiRef: z.string().max(200).optional(), // optional digest / address / object id to observe
});

export const askAnswerSchema = z.object({
  recommendation: z.string().min(1),
  uncertainty: z.object({
    level: z.enum(["low", "medium", "high"]),
    why: z.string().min(1),
  }),
  verifiedFacts: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  inferences: z.array(z.string()).default([]),
  unknowns: z.array(z.string()).default([]),
  memoriesUsed: z
    .array(z.object({ memoryId: z.string(), influence: z.string().min(1) }))
    .default([]),
  lessonsApplied: z.array(z.string()).default([]),
  wouldChangeIf: z.string().min(1),
});
export type AskAnswer = z.infer<typeof askAnswerSchema>;

/* ------------------------------------------------------------------ */
/* Learning engine                                                     */
/* ------------------------------------------------------------------ */

export const lessonActionSchema = z.object({
  lessonId: z.string().min(1),
  action: z.enum(["promote", "apply", "reevaluate", "reject"]),
});

export const compareInputSchema = z.object({
  question: z.string().min(4).max(1000),
});

/* ------------------------------------------------------------------ */
/* ChainLens                                                           */
/* ------------------------------------------------------------------ */

export const chainQuerySchema = z.object({
  kind: z.enum(["CHECKPOINT", "TRANSACTION", "BALANCE", "OWNED_OBJECTS"]),
  ref: z.string().max(200).optional(),
  address: z.string().max(200).optional(),
});

/* ------------------------------------------------------------------ */
/* Memory write (user-facing)                                          */
/* ------------------------------------------------------------------ */

export const memoryWriteSchema = z.object({
  category: z.enum(MEMORY_CATEGORIES),
  content: z.string().min(4).max(1200),
  importance: z.number().int().min(1).max(5).default(3),
  tags: z.array(z.string().min(1).max(40)).max(8).default([]),
  decisionId: z.string().nullish(),
});

/* ------------------------------------------------------------------ */
/* JSON column codecs (parse safely, never trust stored shape)         */
/* ------------------------------------------------------------------ */

export function parseJsonArray<T>(raw: string | null | undefined, schema: z.ZodType<T>): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const result = schema.safeParse(item);
      return result.success ? [result.data] : [];
    });
  } catch {
    return [];
  }
}

export function parseJsonObject<T>(raw: string | null | undefined, schema: z.ZodType<T>): T | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const result = schema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
