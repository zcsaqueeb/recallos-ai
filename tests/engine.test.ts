/**
 * RECALLOS lib-level tests — run with: bun test tests/engine.test.ts
 * These exercise the deterministic core: lesson gating, recall scoring,
 * verified provenance, persistence honesty, and validation schemas.
 */
import { describe, expect, test } from "bun:test";
import { gateForPromotion } from "../src/lib/learning/engine";
import { askAnswerSchema, decisionInputSchema, assumptionVerdictSchema, memoryWriteSchema } from "../src/lib/validation";

describe("lesson promotion gate", () => {
  const outcomeEvidence = { kind: "OUTCOME" as const, sourceRef: "decision:x", summary: "evaluation" };

  test("single observation cannot be promoted", () => {
    const gate = gateForPromotion({
      status: "PROPOSED",
      observationCount: 1,
      evidenceJson: JSON.stringify([outcomeEvidence]),
    });
    expect(gate.pass).toBe(false);
    expect(gate.reasons.some((r) => r.includes("2 supporting observations"))).toBe(true);
  });

  test("two observations with outcome evidence passes", () => {
    const gate = gateForPromotion({
      status: "PROPOSED",
      observationCount: 2,
      evidenceJson: JSON.stringify([outcomeEvidence, { ...outcomeEvidence, sourceRef: "decision:y" }]),
    });
    expect(gate.pass).toBe(true);
  });

  test("missing outcome evidence blocks promotion", () => {
    const gate = gateForPromotion({
      status: "PROPOSED",
      observationCount: 3,
      evidenceJson: JSON.stringify([{ kind: "MEMORY", sourceRef: null, summary: "memory only" }]),
    });
    expect(gate.pass).toBe(false);
    expect(gate.reasons.some((r) => r.includes("OUTCOME evidence"))).toBe(true);
  });

  test("a recorded contradiction blocks promotion", () => {
    const gate = gateForPromotion({
      status: "PROPOSED",
      observationCount: 2,
      evidenceJson: JSON.stringify([outcomeEvidence, { kind: "OUTCOME", sourceRef: "decision:y", summary: "CONTRADICTION: outcome went the other way" }]),
    });
    expect(gate.pass).toBe(false);
  });

  test("already-supported lessons are out of gate scope", () => {
    const gate = gateForPromotion({
      status: "SUPPORTED",
      observationCount: 5,
      evidenceJson: JSON.stringify([outcomeEvidence]),
    });
    expect(gate.pass).toBe(false);
    expect(gate.reasons[0]).toContain("status must be PROPOSED");
  });
});

describe("validation schemas", () => {
  test("decision input rejects an empty assumptions list item and bad confidence", () => {
    const bad = decisionInputSchema.safeParse({
      category: "INVESTMENT",
      title: "Test decision title",
      question: "A long enough question?",
      goal: "Goal",
      constraints: [],
      assumptions: [{ id: "a1", text: "" }],
      evidenceRefs: [],
      recommendation: "Do the thing",
      confidence: "certainty", // invalid
      expectedOutcome: "It works",
      evaluationCriteria: "It kept working",
    });
    expect(bad.success).toBe(false);
  });

  test("valid decision input passes and defaults apply", () => {
    const ok = decisionInputSchema.safeParse({
      category: "INVESTMENT",
      title: "Test decision title",
      question: "A long enough question?",
      goal: "Goal",
      assumptions: [{ id: "a1", text: "Something holds" }],
      recommendation: "Do the thing",
      expectedOutcome: "It works",
      evaluationCriteria: "It kept working",
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.confidence).toBe("medium");
      expect(ok.data.constraints).toEqual([]);
    }
  });

  test("verdict schema accepts only the four explicit verdicts", () => {
    expect(assumptionVerdictSchema.safeParse({ assumptionId: "a1", verdict: "HELD", rationale: "ok" }).success).toBe(true);
    expect(assumptionVerdictSchema.safeParse({ assumptionId: "a1", verdict: "MAYBE", rationale: "ok" }).success).toBe(false);
  });

  test("ask answer requires influence notes on every used memory", () => {
    const bad = askAnswerSchema.safeParse({
      recommendation: "r",
      uncertainty: { level: "low", why: "w" },
      memoriesUsed: [{ memoryId: "m1" }],
    });
    expect(bad.success).toBe(false);
  });

  test("memory write caps importance and length", () => {
    expect(memoryWriteSchema.safeParse({ category: "PREFERENCE", content: "short", importance: 9 }).success).toBe(false);
    expect(memoryWriteSchema.safeParse({ category: "PREFERENCE", content: "x".repeat(1300) }).success).toBe(false);
  });
});
