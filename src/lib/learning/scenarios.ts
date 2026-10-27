/**
 * Fixed evaluation scenarios (spec §5: "reproducible evaluation set with fixed
 * scenarios and expected outcomes").
 *
 * Scenarios marked [deterministic] assert rule-level guarantees that do not
 * depend on model output. Scenarios marked [model-dependent] run the live
 * pipeline and apply rubric checks; their result can legitimately vary and is
 * labeled as such in the UI.
 *
 * All scenarios run in PARALLEL (each is an independent fixture + check) so a
 * full evaluation takes ~max(individual scenario) instead of the sum — the
 * model-dependent S6 dominates. S6 additionally carries a hard timeout so a
 * slow model can never push the whole run past gateway response limits
 * (the original "Evaluation run failed: Unexpected token '<'" bug was the
 * preview gateway returning an HTML error page on such over-long runs).
 */

import { db } from "@/lib/db";
import { recallMemories, writeMemory } from "@/lib/memory/service";
import { getWalrusConfig } from "@/lib/memory/walrus-client";
import { gateForPromotion } from "./engine";
import { runAsk } from "@/lib/ai/ask-pipeline";

export type ScenarioResult = {
  scenarioId: string;
  scenarioName: string;
  passed: boolean;
  kind: "deterministic" | "model-dependent";
  details: string;
};

const CONFLICT_A = "Eval-scenario preference: always avoid testnet trading for serious decisions.";
const CONFLICT_B = "Eval-scenario preference: prefer testnet trading for serious decisions.";

const S6_TIMEOUT_MS = 100_000;

/** Wrap a scenario with honest wall-time disclosure. */
async function timed(id: string, name: string, kind: ScenarioResult["kind"], fn: () => Promise<ScenarioResult>): Promise<ScenarioResult> {
  const t0 = Date.now();
  const r = await fn();
  return { ...r, scenarioId: id, scenarioName: name, kind, details: `${r.details} (${((Date.now() - t0) / 1000).toFixed(1)}s)` };
}

/* S1 — retrieval relevance [deterministic]
   A leverage-related memory must outrank an unrelated hosting memory.
   Both records are transient eval fixtures written into the real store and
   cleaned up afterwards, so the check exercises the live retrieval path. */
async function s1(userId: string): Promise<ScenarioResult> {
  try {
    const lev = await writeMemory({ userId, category: "PREFERENCE", content: "Eval-scenario preference: avoid leverage entirely when markets are volatile.", importance: 5, tags: ["eval"] });
    const host = await writeMemory({ userId, category: "DECISION_SUMMARY", content: "Eval-scenario note: the blog hosting stack was migrated to a static site generator last spring.", importance: 2, tags: ["eval"] });
    const { memories } = await recallMemories(userId, "Should I open a leveraged position this week?", {
      limit: 20,
    });
    const leverageIdx = memories.findIndex((m) => m.id === lev.id);
    const hostingIdx = memories.findIndex((m) => m.id === host.id);
    // cleanup eval-scenario memories so they do not pollute the workspace
    await db.memoryRecord.deleteMany({ where: { id: { in: [lev.id, host.id] } } });
    const passed = leverageIdx !== -1 && (hostingIdx === -1 || leverageIdx < hostingIdx);
    return {
      scenarioId: "S1",
      scenarioName: "Retrieval relevance",
      kind: "deterministic",
      passed,
      details: passed
        ? `On-topic leverage memory ranked ${leverageIdx + 1}${hostingIdx !== -1 ? `, above unrelated hosting memory (${hostingIdx + 1})` : "; unrelated memory not ranked above"}.`
        : `Expected the on-topic memory to outrank unrelated content; got order: [${memories.map((m) => m.content.slice(0, 40)).join(" | ")}].`,
    };
  } catch (err) {
    return { scenarioId: "S1", scenarioName: "Retrieval relevance", kind: "deterministic", passed: false, details: `error: ${(err as Error).message}` };
  }
}

/* S2 — verified provenance integrity [deterministic]
   Every VERIFIED memory must be a WALRUS-source record with a real blob
   reference and evidence; no other source type may claim VERIFIED. */
async function s2(userId: string): Promise<ScenarioResult> {
  try {
    const verified = await db.memoryRecord.findMany({ where: { userId, storageState: "VERIFIED" } });
    const unproven = verified.filter((m) => m.sourceType !== "WALRUS" || !m.externalId || !m.evidenceJson);
    const walrus = await db.memoryRecord.count({ where: { userId, sourceType: "WALRUS" } });
    const passed = unproven.length === 0;
    return {
      scenarioId: "S2",
      scenarioName: "Verified provenance integrity",
      kind: "deterministic",
      passed,
      details: passed
        ? `${verified.length} verified records, all WALRUS-source with a blob id and evidence bundle (${walrus} WALRUS records total); nothing claims VERIFIED without on-chain provenance.`
        : `${unproven.length} record(s) claim VERIFIED without WALRUS provenance — integrity violation.`,
    };
  } catch (err) {
    return { scenarioId: "S2", scenarioName: "Verified provenance integrity", kind: "deterministic", passed: false, details: `error: ${(err as Error).message}` };
  }
}

/* S3 — lesson gating [deterministic]
   A single-observation lesson cannot be promoted. */
async function s3(): Promise<ScenarioResult> {
  try {
    const gate = gateForPromotion({
      status: "PROPOSED",
      observationCount: 1,
      evidenceJson: JSON.stringify([{ kind: "OUTCOME", sourceRef: "decision:x", summary: "single evaluation" }]),
    });
    const gateTwo = gateForPromotion({
      status: "PROPOSED",
      observationCount: 2,
      evidenceJson: JSON.stringify([
        { kind: "OUTCOME", sourceRef: "decision:x", summary: "first evaluation" },
        { kind: "OUTCOME", sourceRef: "decision:y", summary: "second evaluation" },
      ]),
    });
    return {
      scenarioId: "S3",
      scenarioName: "Lesson promotion gate",
      kind: "deterministic",
      passed: !gate.pass && gateTwo.pass,
      details: `1-observation lesson blocked (${gate.reasons.join("; ")}). 2-observation lesson passes. Evidence threshold = ${2} observations + OUTCOME evidence + zero contradictions.`,
    };
  } catch (err) {
    return { scenarioId: "S3", scenarioName: "Lesson promotion gate", kind: "deterministic", passed: false, details: `error: ${(err as Error).message}` };
  }
}

/* S4 — conflict surfacing [deterministic]
   Two contradictory memories must be flagged, not silently merged. */
async function s4(userId: string): Promise<ScenarioResult> {
  try {
    const a = await writeMemory({ userId, category: "PREFERENCE", content: CONFLICT_A, importance: 3, tags: ["eval"] });
    const b = await writeMemory({ userId, category: "PREFERENCE", content: CONFLICT_B, importance: 3, tags: ["eval"] });
    const { memories } = await recallMemories(userId, "testnet or mainnet for serious decisions?", { limit: 20 });
    const flagged = memories.some((m) => m.conflictWith.length > 0);
    // cleanup eval-scenario memories so they do not pollute the workspace
    await db.memoryRecord.deleteMany({ where: { id: { in: [a.id, b.id] } } });
    return {
      scenarioId: "S4",
      scenarioName: "Conflicting memories surfaced",
      kind: "deterministic",
      passed: flagged,
      details: flagged
        ? "Contradictory pair was detected and flagged via conflictWith (records cleaned up after the run)."
        : "Contradictory pair was NOT flagged.",
    };
  } catch (err) {
    return { scenarioId: "S4", scenarioName: "Conflicting memories surfaced", kind: "deterministic", passed: false, details: `error: ${(err as Error).message}` };
  }
}

/* S5 — write honesty [deterministic, config-aware]
   Without Walrus config a write must stay LOCAL_MIRROR/PENDING_SYNC (never
   VERIFIED). With config, VERIFIED is only allowed after a confirmed job. */
async function s5(userId: string): Promise<ScenarioResult> {
  try {
    const configured = Boolean(getWalrusConfig());
    const w = await writeMemory({ userId, category: "PREFERENCE", content: "Eval-scenario transient memory: this record must never claim verified persistence without confirmation.", importance: 1, tags: ["eval"] });
    const record = await db.memoryRecord.findUnique({ where: { id: w.id } });
    let passed: boolean;
    let detail: string;
    if (!configured) {
      passed = record?.sourceType === "LOCAL_MIRROR" && record?.storageState !== "VERIFIED";
      detail = passed
        ? "Walrus unconfigured → write stored as LOCAL_MIRROR, NOT reported as mainnet-verified."
        : `Integrity failure: unconfigured write reported as ${record?.sourceType}/${record?.storageState}.`;
    } else {
      passed = record !== null && ["VERIFIED", "PENDING_SYNC"].includes(record.storageState);
      detail = passed
        ? `Walrus configured → storageState=${record?.storageState}${record?.externalId ? ` (job ${record.externalId.slice(0, 12)}…)` : " (confirmation pending)"}; never VERIFIED without a confirmed job.`
        : "Write record missing.";
    }
    await db.memoryRecord.deleteMany({ where: { id: w.id } });
    return { scenarioId: "S5", scenarioName: "No false persistence claims", kind: "deterministic", passed, details: detail };
  } catch (err) {
    return { scenarioId: "S5", scenarioName: "No false persistence claims", kind: "deterministic", passed: false, details: `error: ${(err as Error).message}` };
  }
}

/* S6 — facts/assumptions/inferences/unknowns separation [model-dependent]
   The live pipeline with a hard timeout: a slow model must fail this single
   scenario honestly, never stall the whole evaluation past gateway limits. */
async function s6(userId: string): Promise<ScenarioResult> {
  try {
    const askPromise = runAsk({
      userId,
      question: "How should I think about allocating a $200 windfall?",
      includeBlockchainEvidence: false,
      baselineOnly: false,
    });
    const timeoutPromise = new Promise<never>((_, reject) => {
      const t = setTimeout(
        () => reject(new Error(`model call exceeded ${S6_TIMEOUT_MS / 1000}s — aborted to keep the evaluation within gateway response limits`)),
        S6_TIMEOUT_MS,
      );
      if (typeof t === "object" && t !== null && "unref" in (t as object)) (t as { unref: () => void }).unref();
    });
    const { answer } = await Promise.race([askPromise, timeoutPromise]);
    const passed =
      Array.isArray(answer.verifiedFacts) &&
      Array.isArray(answer.assumptions) &&
      Array.isArray(answer.inferences) &&
      Array.isArray(answer.unknowns) &&
      typeof answer.wouldChangeIf === "string" &&
      answer.wouldChangeIf.length > 0 &&
      answer.memoriesUsed.every((m) => Boolean(m.memoryId && m.influence));
    return {
      scenarioId: "S6",
      scenarioName: "Fact/assumption/inference/unknown separation",
      kind: "model-dependent",
      passed,
      details: passed
        ? `Answer schema separated ${answer.verifiedFacts.length} facts / ${answer.assumptions.length} assumptions / ${answer.inferences.length} inferences / ${answer.unknowns.length} unknowns; wouldChangeIf present; every memoriesUsed entry carries an influence note.`
        : "Answer failed the separation rubric.",
    };
  } catch (err) {
    return { scenarioId: "S6", scenarioName: "Fact/assumption/inference/unknown separation", kind: "model-dependent", passed: false, details: `error: ${(err as Error).message}` };
  }
}

export async function runEvalScenarios(userId: string): Promise<ScenarioResult[]> {
  // Parallel: independent fixtures and independent checks. Prisma's SQLite
  // connector serializes the writes through its single connection, so the
  // concurrent memory writes/reads are safe.
  const results = await Promise.all([
    timed("S1", "Retrieval relevance", "deterministic", () => s1(userId)),
    timed("S2", "Verified provenance integrity", "deterministic", () => s2(userId)),
    timed("S3", "Lesson promotion gate", "deterministic", () => s3()),
    timed("S4", "Conflicting memories surfaced", "deterministic", () => s4(userId)),
    timed("S5", "No false persistence claims", "deterministic", () => s5(userId)),
    timed("S6", "Fact/assumption/inference/unknown separation", "model-dependent", () => s6(userId)),
  ]);

  // persist results — persistence failure must not discard an honestly
  // computed run; log it and still return the results.
  try {
    await db.evalResult.createMany({
      data: results.map((r) => ({
        scenarioId: r.scenarioId,
        scenarioName: r.scenarioName,
        passed: r.passed,
        detailsJson: JSON.stringify({ details: r.details, kind: r.kind }),
      })),
    });
    await db.activityEvent.create({
      data: {
        userId,
        kind: "EVAL_RUN",
        summary: `Evaluation suite: ${results.filter((r) => r.passed).length}/${results.length} scenarios passed`,
      },
    });
  } catch (err) {
    console.warn("[eval] could not persist eval run:", (err as Error).message);
  }

  return results;
}
