import { db } from "@/lib/db";
import { getWalrusConfig, getWalrusConfigResolved, getWalrusNamespace, walrusRecall, walrusRemember, type WalrusEvidence } from "./walrus-client";
import { MEMORY_SOURCE_TYPES, MEMORY_CATEGORIES } from "@/lib/validation";

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export type WriteMemoryInput = {
  userId: string;
  category: MemoryCategory;
  content: string;
  importance?: number;
  tags?: string[];
  decisionId?: string | null;
};

export type WriteMemoryResult = {
  id: string;
  sourceType: "WALRUS" | "LOCAL_MIRROR";
  storageState: "VERIFIED" | "PENDING_SYNC" | "FAILED";
  externalId: string | null;
  walrusError: string | null;
  /** Verifiable Walrus proof bundle (blob id, aggregator/explorer links) when VERIFIED. */
  evidence?: WalrusEvidence | null;
};

/** Parse a stored WalrusEvidence JSON column, tolerating legacy/missing values. */
export function parseEvidence(json: string | null | undefined): WalrusEvidence | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return v && typeof v.blobId === "string" && typeof v.aggregatorUrl === "string" ? (v as WalrusEvidence) : null;
  } catch {
    return null;
  }
}

/**
 * Normalizes content for duplicate detection: whitespace-collapsed lowercase.
 * Exact duplicates are skipped (existing record returned) so repeated writes
 * (e.g. re-asks, re-evaluations) do not spam the memory space.
 */
function dedupeKey(content: string): string {
  return content.toLowerCase().replace(/\s+/g, " ").trim();
}

async function findDuplicate(userId: string, content: string, category: MemoryCategory) {
  const key = dedupeKey(content);
  const candidates = await db.memoryRecord.findMany({
    where: { userId, category },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return candidates.find((m) => dedupeKey(m.content) === key) ?? null;
}

/**
 * Write policy:
 *  1. Dedupe against existing memories for the workspace.
 *  2. Persist locally first (durable application copy, sourceType LOCAL_MIRROR).
 *  3. Attempt the REAL Walrus write. Only a confirmed remember-job upgrades the
 *     record to sourceType WALRUS / storageState VERIFIED. Failures keep the
 *     record PENDING_SYNC and are returned to the caller for disclosure —
 *     we never claim mainnet persistence that did not happen.
 */
export async function writeMemory(input: WriteMemoryInput): Promise<WriteMemoryResult> {
  const dupe = await findDuplicate(input.userId, input.content, input.category);
  if (dupe) {
    return {
      id: dupe.id,
      sourceType: dupe.sourceType as WriteMemoryResult["sourceType"],
      storageState: dupe.storageState as WriteMemoryResult["storageState"],
      externalId: dupe.externalId,
      walrusError: null,
      evidence: parseEvidence(dupe.evidenceJson),
    };
  }

  const record = await db.memoryRecord.create({
    data: {
      userId: input.userId,
      category: input.category,
      content: input.content,
      sourceType: "LOCAL_MIRROR",
      storageState: "PENDING_SYNC",
      importance: input.importance ?? 3,
      tagsJson: JSON.stringify(input.tags ?? []),
      decisionId: input.decisionId ?? null,
    },
  });

  const walrusResult = await walrusRemember(input.content);
  if (walrusResult.ok && walrusResult.confirmed) {
    const updated = await db.memoryRecord.update({
      where: { id: record.id },
      data: {
        sourceType: "WALRUS",
        storageState: "VERIFIED",
        externalId: walrusResult.blobId ?? walrusResult.jobId,
        namespace: walrusResult.evidence?.namespace ?? getWalrusConfig()?.namespace ?? null,
        evidenceJson: walrusResult.evidence ? JSON.stringify(walrusResult.evidence) : null,
        verifiedAt: new Date(),
      },
    });
    return {
      id: updated.id,
      sourceType: "WALRUS",
      storageState: "VERIFIED",
      externalId: updated.externalId,
      walrusError: null,
      evidence: walrusResult.evidence ?? null,
    };
  }

  const failureReason = walrusResult.ok
    ? "WALRUS_CONFIRMATION_TIMEOUT"
    : walrusResult.reason;
  await db.memoryRecord.update({
    where: { id: record.id },
    data: {
      storageState: "PENDING_SYNC",
      // Staged-but-unconfirmed writes keep their blob/job reference for traceability.
      externalId: walrusResult.ok ? (walrusResult.blobId ?? walrusResult.jobId) : null,
    },
  });
  return {
    id: record.id,
    sourceType: "LOCAL_MIRROR",
    storageState: "PENDING_SYNC",
    externalId: null,
    walrusError: failureReason,
  };
}

export type RecalledMemory = {
  id: string;
  category: string;
  content: string;
  sourceType: string;
  storageState: string;
  importance: number;
  createdAt: Date;
  score: number;
  conflictWith: string[]; // ids of memories with contradictory stance
  evidence?: WalrusEvidence | null;
};

const CONTRAST_HINTS: Array<[RegExp, RegExp]> = [
  [/\bprefer\b|\bonly\b|\bavoid\b|\bnever\b|\balways\b|\bmax(imum)?\b|\bmin(imum)?\b/i, /\bprefer\b|\bonly\b|\bavoid\b|\bnever\b|\balways\b|\bmax(imum)?\b|\bmin(imum)?\b/i],
];

/**
 * Recall policy:
 *  1. Deterministic keyword/category scoring over the local durable store
 *     (works with zero external dependencies; every record carries provenance).
 *  2. If Walrus is configured, ALSO recall from the real memory space and merge
 *     results that are not already present (marked by externalId).
 *  3. Conflicts are detected (opposing preference statements in the same
 *     category) and surfaced — never silently resolved.
 *  4. Retrieval failures are disclosed in the result, not hidden.
 */
export async function recallMemories(
  userId: string,
  query: string,
  opts: { limit?: number } = {},
): Promise<{ memories: RecalledMemory[]; walrusRecallError: string | null; walrusExtra: number }> {
  const limit = opts.limit ?? 8;

  const local = await db.memoryRecord.findMany({
    where: { userId },
    orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
    take: 400,
  });

  const terms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);

  const scored: RecalledMemory[] = local.map((m) => {
    const text = m.content.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (text.includes(t)) score += 2;
    }
    // category-term overlap (e.g. "risk" <-> CONSTRAINT) gets a small boost
    if (m.category === "CONSTRAINT" && /risk|limit|budget|constraint|never|avoid/.test(query.toLowerCase())) score += 1;
    if (m.category === "GOAL" && /goal|target|want|plan|objective/.test(query.toLowerCase())) score += 1;
    if (m.category === "PREFERENCE" && /prefer|like|favor|style|want/.test(query.toLowerCase())) score += 1;
    if (m.category === "LESSON" && /lesson|learned|last time|before|previous/.test(query.toLowerCase())) score += 2;
    score += (m.importance - 3) * 0.1;
    return {
      id: m.id,
      category: m.category,
      content: m.content,
      sourceType: m.sourceType,
      storageState: m.storageState,
      importance: m.importance,
      createdAt: m.createdAt,
      score,
      conflictWith: [],
      evidence: parseEvidence(m.evidenceJson),
    };
  });

  // Conflict detection: same category, both contain contrast markers, and the
  // statements disagree on a shared term (naive but explicit; we surface, not resolve).
  for (const a of scored) {
    for (const b of scored) {
      if (a.id === b.id || a.category !== b.category || b.conflictWith.includes(a.id)) continue;
      const [markA] = CONTRAST_HINTS[0];
      if (!markA.test(a.content) || !markA.test(b.content)) continue;
      const avoidA = /\bavoid\b|\bnever\b|\bnot\b|\bno\b/i.test(a.content);
      const avoidB = /\bavoid\b|\bnever\b|\bnot\b|\bno\b/i.test(b.content);
      const sharedTerm = terms.some((t) => a.content.toLowerCase().includes(t) && b.content.toLowerCase().includes(t));
      if (avoidA !== avoidB && sharedTerm) {
        a.conflictWith.push(b.id);
      }
    }
  }

  const top = scored
    .filter((m) => m.score > 0 || m.importance >= 4)
    .sort((a, b) => b.score - a.score || b.importance - a.importance)
    .slice(0, limit);

  // Real Walrus recall (when configured) merged by content overlap.
  let walrusExtra = 0;
  let walrusRecallError: string | null = null;
  if (await getWalrusConfigResolved()) {
    const remote = await walrusRecall(query);
    if (remote.ok) {
      for (const rm of remote.memories) {
        const alreadyThere = top.some((t) => dedupeKey(t.content) === dedupeKey(rm.content));
        if (!alreadyThere && top.length < limit) {
          top.push({
            id: `walrus:${rm.externalId ?? "unknown"}`,
            category: "WALRUS_REMOTE",
            content: rm.content,
            sourceType: "WALRUS",
            storageState: "VERIFIED",
            importance: 3,
            createdAt: new Date(),
            score: 1,
            conflictWith: [],
          });
          walrusExtra += 1;
        }
      }
    } else {
      walrusRecallError = remote.reason;
    }
  }

  return { memories: top, walrusRecallError, walrusExtra };
}
