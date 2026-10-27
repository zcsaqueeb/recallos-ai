/**
 * Walrus Memory client — REAL integration, dual transport.
 *
 * Primary transport (live since 2026-10): Tatum Walrus Storage API.
 *   The same server-side TATUM_API_KEY used for Sui GraphQL also writes blobs to
 *   Walrus mainnet (POST /v4/data/storage/upload → poll → CERTIFIED). Certification
 *   is an on-chain event (register + certify txs on Sui); the blob is then readable
 *   from any public Walrus aggregator by quilt patch id. Storage defaults to ~4
 *   epochs (~8 weeks) and is auto-renewed by Tatum.
 *
 * Secondary transport (optional): official MemWal SDK (@mysten-incubation/memwal)
 *   with WALRUS_MEMORY_DELEGATE_KEY / WALRUS_MEMORY_ACCOUNT_ID /
 *   WALRUS_MEMORY_SERVER_URL. Enabled automatically if those credentials are ever
 *   provided; takes precedence over the Tatum transport when present.
 *
 * Never report persistence unless the transport confirms the write: a memory is
 * only VERIFIED after the blob reaches CERTIFIED status on Walrus mainnet.
 */

import { db } from "@/lib/db";
import {
  fetchFromAggregator,
  tatumWalrusListUploads,
  tatumWalrusUpload,
  waitForWalrusCertification,
  type WalrusJob,
} from "@/lib/tatum/walrus";

export type WalrusTransport = "tatum-storage-api" | "memwal-sdk" | null;

/** Where the active credentials came from: saved via the Settings UI, or the server .env. */
export type WalrusConfigSource = "custom" | "env";

export type WalrusConfig = {
  transport: Exclude<WalrusTransport, null>;
  namespace: string;
  delegateKey?: string;
  accountId?: string;
  serverUrl?: string;
  source?: WalrusConfigSource;
};

export type WalrusStatus = {
  configured: boolean;
  transport: WalrusTransport;
  network: string;
  sdkInstalled: boolean;
  missingEnv: string[];
  namespace: string | null;
  serverUrl: string | null;
};

export function getWalrusNamespace(): string {
  return process.env.WALRUS_MEMORY_NAMESPACE || "recallos";
}

/** Real SDK load result — set on the first loadMemWalClient() attempt (status probe triggers it). */
let memwalSdkProbe: boolean | undefined;

/**
 * ENV-ONLY config (sync). Used as the fallback layer and by legacy callers that
 * cannot await. The runtime decision uses getWalrusConfigResolved() below.
 */
export function getWalrusConfig(): WalrusConfig | null {
  const namespace = process.env.WALRUS_MEMORY_NAMESPACE || "recallos";
  // Accept the WALRUS_MEMORY_* names and the MEMWAL_* aliases used by the official docs.
  const delegateKey = process.env.WALRUS_MEMORY_DELEGATE_KEY || process.env.MEMWAL_PRIVATE_KEY;
  const accountId = process.env.WALRUS_MEMORY_ACCOUNT_ID || process.env.MEMWAL_ACCOUNT_ID;
  const serverUrl = process.env.WALRUS_MEMORY_SERVER_URL || process.env.MEMWAL_SERVER_URL;
  if (delegateKey && accountId && serverUrl) {
    return { transport: "memwal-sdk", namespace, delegateKey, accountId, serverUrl, source: "env" };
  }
  if (process.env.TATUM_API_KEY) {
    return { transport: "tatum-storage-api", namespace, source: "env" };
  }
  return null;
}

export type ResolvedWalrusConfig = WalrusConfig & { source: WalrusConfigSource };

/**
 * Credential resolution order (Settings UI priority):
 *   1. AppSettings singleton row — credentials saved through the Settings UI by the
 *      operator/user of this deployment (complete MemWal set: key + account + URL).
 *   2. Server .env (WALRUS_MEMORY_* / MEMWAL_* for MemWal, TATUM_API_KEY for the
 *      Storage API transport) — the built-in fallback.
 * Partial custom saves are ignored (incomplete) so the runtime never mixes halves
 * of two credential sets.
 */
export async function getWalrusConfigResolved(): Promise<ResolvedWalrusConfig | null> {
  try {
    const s = await db.appSettings.findUnique({ where: { id: "singleton" } });
    if (s?.delegateKey && s?.accountId && s?.serverUrl) {
      return {
        transport: "memwal-sdk",
        namespace: s.namespace?.trim() || getWalrusNamespace(),
        delegateKey: s.delegateKey,
        accountId: s.accountId,
        serverUrl: s.serverUrl,
        source: "custom",
      };
    }
    // A Tatum key saved on its own (without a MemWal set) enables the Storage API
    // transport for memory persistence — the key resolves through the same
    // Settings → .env priority as the Sui gateway (src/lib/tatum/config.ts).
    if (s?.tatumApiKey?.trim()) {
      return { transport: "tatum-storage-api", namespace: getWalrusNamespace(), source: "custom" };
    }
  } catch {
    // Settings table unavailable — fall through to env.
  }
  const envCfg = getWalrusConfig();
  return envCfg ? { ...envCfg, source: envCfg.source ?? "env" } : null;
}

export type WalrusStatusFull = WalrusStatus & {
  /** Which credential set is active right now: saved via Settings UI ("custom") or server .env ("env"). */
  source: WalrusConfigSource | null;
  /** True when a complete MemWal credential set exists in .env as a fallback layer. */
  envFallbackAvailable: boolean;
  /** True when credentials saved through the Settings UI are currently in force. */
  customSaved: boolean;
};

export async function getWalrusStatus(): Promise<WalrusStatusFull> {
  const missingEnv: string[] = [];
  const delegateKey = process.env.WALRUS_MEMORY_DELEGATE_KEY || process.env.MEMWAL_PRIVATE_KEY;
  const accountId = process.env.WALRUS_MEMORY_ACCOUNT_ID || process.env.MEMWAL_ACCOUNT_ID;
  const serverUrl = process.env.WALRUS_MEMORY_SERVER_URL || process.env.MEMWAL_SERVER_URL;
  const envFallbackAvailable = Boolean(delegateKey && accountId && serverUrl);
  const memwalPartial = Boolean(delegateKey || accountId || serverUrl);
  if (memwalPartial && !envFallbackAvailable) {
    if (!delegateKey) missingEnv.push("WALRUS_MEMORY_DELEGATE_KEY");
    if (!accountId) missingEnv.push("WALRUS_MEMORY_ACCOUNT_ID");
    if (!serverUrl) missingEnv.push("WALRUS_MEMORY_SERVER_URL");
  }
  const cfg = await getWalrusConfigResolved();
  const customSaved = cfg?.source === "custom";
  return {
    configured: cfg !== null,
    transport: cfg?.transport ?? null,
    network: cfg ? "mainnet" : "none",
    sdkInstalled: memwalSdkProbe === true,
    missingEnv: customSaved ? [] : missingEnv,
    namespace: cfg?.namespace ?? null,
    serverUrl: cfg?.serverUrl ?? serverUrl ?? null,
    source: cfg?.source ?? null,
    envFallbackAvailable,
    customSaved,
  };
}

/* --------------------------------- MemWal SDK path --------------------------- */

/** Shape of the real @mysten-incubation/memwal client (verified against 0.1.9 typings). */
type MemWalLike = {
  rememberAndWait: (
    text: string,
    namespaceOrOptions?: string | Record<string, any>,
    opts?: Record<string, any>,
  ) => Promise<{ id: string; job_id?: string; blob_id: string; owner: string; namespace: string } & Record<string, any>>;
  waitForRememberJob: (jobId: string, opts?: Record<string, any>) => Promise<Record<string, any>>;
  recall: (params: { query: string; topK?: number; maxDistance?: number }) => Promise<{
    results: Array<{ blob_id: string; text: string; distance: number }>;
    total: number;
    dropped_count?: number;
  }>;
  listMemories: (options?: Record<string, any>) => Promise<Record<string, any>>;
  health: () => Promise<{ status: string; version: string; write_ready?: boolean } & Record<string, any>>;
};

let cachedMemWal: MemWalLike | null | undefined;
/** Fingerprint of the credentials the cached client was built from — a mismatch forces a rebuild. */
let cachedMemWalFingerprint: string | null = null;
/** Last MemWal failure (auth, relayer, SDK) — surfaced by the status probe for honest reporting. */
export let memwalLastError: string | null = null;

function noteMemwalFailure(err: unknown) {
  memwalLastError = err instanceof Error ? err.message : String(err);
  console.warn("[walrus] MemWal transport failed (%s) — falling back to the Tatum Storage API.", memwalLastError.slice(0, 160));
}

function memwalFingerprint(cfg: WalrusConfig): string {
  return [cfg.delegateKey ?? "", cfg.accountId ?? "", cfg.serverUrl ?? "", cfg.namespace].join("|");
}

/**
 * Clears every cached runtime artifact (MemWal client, live-probe cache, last error).
 * Called after credentials are saved or removed via the Settings API so the next
 * operation builds a client from the fresh credential set.
 */
export function resetWalrusRuntime() {
  cachedMemWal = undefined;
  cachedMemWalFingerprint = null;
  probeCache = null;
  memwalLastError = null;
}

async function loadMemWalClient(cfg: ResolvedWalrusConfig): Promise<MemWalLike | null> {
  const fp = memwalFingerprint(cfg);
  if (cachedMemWal !== undefined && cachedMemWalFingerprint === fp) return cachedMemWal;
  if (cfg.transport !== "memwal-sdk") {
    cachedMemWal = null;
    cachedMemWalFingerprint = null;
    return null;
  }
  try {
    const mod: any = await import("@mysten-incubation/memwal");
    const MemWal = mod?.MemWal ?? mod?.default?.MemWal ?? mod?.default;
    if (typeof MemWal?.create !== "function") throw new Error("MemWal.create not found");
    cachedMemWal = MemWal.create({
      key: cfg.delegateKey,
      accountId: cfg.accountId,
      serverUrl: cfg.serverUrl,
      namespace: cfg.namespace,
    }) as MemWalLike;
    cachedMemWalFingerprint = fp;
    memwalSdkProbe = true;
  } catch (err) {
    memwalSdkProbe = false;
    noteMemwalFailure(err);
    cachedMemWal = null;
    cachedMemWalFingerprint = null;
  }
  return cachedMemWal;
}

/* --------------------------------- Write path --------------------------------- */

export type WalrusWriteResult =
  | {
      ok: true;
      transport: Exclude<WalrusTransport, null>;
      jobId: string;
      confirmed: boolean;
      blobId?: string;
      suiObjectId?: string;
      downloadUrl?: string;
      walrusEpochs?: { start: number; end: number } | null;
      /** Set when the MemWal attempt failed and the Tatum transport stored the memory instead. */
      fallbackReason?: string;
      evidence?: WalrusEvidence | null;
      raw: unknown;
    }
  | { ok: false; transport: WalrusTransport; reason: string };

/**
 * Verifiable proof bundle for one confirmed Walrus write. Surfaced in the UI so
 * every VERIFIED memory can be independently checked: raw bytes from a public
 * aggregator, on-chain blob certification from a block explorer, and transport
 * specifics (epochs for direct uploads, owner account for MemWal relays).
 */
export type WalrusEvidence = {
  blobId: string;
  transport: Exclude<WalrusTransport, null>;
  /** Read the stored bytes back from the public Walrus aggregator. */
  aggregatorUrl: string;
  /** On-chain certification proof page (block explorer). */
  explorerUrl: string;
  /** Sui explorer link for the owning object (blob object or MemWalAccount). */
  suiObjectUrl?: string;
  ownerAccount?: string;
  namespace?: string;
  epochs?: { start: number; end: number } | null;
  certifiedAt: string;
};

const AGGREGATOR_BASE = "https://aggregator.walrus-mainnet.walrus.space";

/** Build the verifiable proof bundle from a confirmed write result. */
export function buildWalrusEvidence(result: Extract<WalrusWriteResult, { ok: true }>, cfg?: WalrusConfig): WalrusEvidence | null {
  if (!result.blobId) return null;
  const aggregatorUrl =
    result.downloadUrl ?? `${AGGREGATOR_BASE}/v1/blobs/${result.blobId}`;
  const evidence: WalrusEvidence = {
    blobId: result.blobId,
    transport: result.transport,
    aggregatorUrl,
    explorerUrl: `https://walruscan.com/mainnet/blob/${result.blobId}`,
    epochs: result.walrusEpochs ?? null,
    certifiedAt: new Date().toISOString(),
  };
  if (result.suiObjectId) {
    // Tatum path: the on-chain blob object. MemWal path: r.owner (the account).
    if (result.transport === "tatum-storage-api") evidence.suiObjectUrl = `https://suiscan.xyz/mainnet/object/${result.suiObjectId}`;
    else evidence.ownerAccount = result.suiObjectId;
  }
  evidence.namespace = cfg?.namespace ?? getWalrusConfig()?.namespace;
  return evidence;
}

const MEMORY_FILE_PREFIX = "recallos-mem-";

/**
 * Write-through with transport fallback:
 *   1. MemWal relayer (when credentials are set) — encrypted, semantically indexed
 *      memory via rememberAndWait; confirmed only when the relayer returns a blob_id.
 *   2. Tatum Storage API fallback (also the primary when MemWal is not configured) —
 *      blob staged + polled until CERTIFIED on-chain.
 * A failed MemWal attempt never blocks persistence: the write falls through and the
 * result reports which transport actually stored the memory.
 */
export async function walrusRemember(text: string): Promise<WalrusWriteResult> {
  const cfg = await getWalrusConfigResolved();
  if (!cfg) return { ok: false, transport: null, reason: "WALRUS_NO_TRANSPORT" };

  let memwalFailure: string | null = null;
  if (cfg.transport === "memwal-sdk") {
    const client = await loadMemWalClient(cfg);
    if (!client) {
      memwalFailure = memwalLastError ?? "WALRUS_SDK_UNAVAILABLE";
    } else {
      try {
        const r = await client.rememberAndWait(text, undefined, { timeoutMs: 60_000 });
        if (!r?.blob_id) throw new Error("WALRUS_JOB_ID_MISSING (no blob_id in relayer result)");
        const memwalResult: Extract<WalrusWriteResult, { ok: true }> = {
          ok: true,
          transport: "memwal-sdk",
          jobId: r.job_id ?? r.id,
          confirmed: true,
          blobId: r.blob_id,
          suiObjectId: r.owner,
          downloadUrl: undefined,
          walrusEpochs: null,
          raw: r,
        };
        memwalResult.evidence = buildWalrusEvidence(memwalResult, cfg);
        return memwalResult;
      } catch (err) {
        noteMemwalFailure(err);
        memwalFailure = memwalLastError;
      }
    }
    console.warn("[walrus] MemWal write failed (%s) — attempting Tatum Storage API fallback.", (memwalFailure ?? "").slice(0, 160));
  }

  // Tatum Storage API transport (fallback or primary).
  try {
    const filename = `${MEMORY_FILE_PREFIX}${Date.now()}.txt`;
    const staged = await tatumWalrusUpload(Buffer.from(text, "utf8"), filename);
    const jobId = staged.jobId;
    const certified = await waitForWalrusCertification(jobId);
    if (certified.ok) {
      const tatumResult: Extract<WalrusWriteResult, { ok: true }> = {
        ok: true,
        transport: "tatum-storage-api",
        jobId,
        confirmed: true,
        blobId: certified.job.blobId,
        suiObjectId: certified.job.suiObjectId,
        downloadUrl: certified.job.downloadUrlByQuiltPatchId ?? certified.job.downloadUrlByQuiltId,
        walrusEpochs:
          typeof certified.job.walrusStartEpoch === "number" && typeof certified.job.walrusEndEpoch === "number"
            ? { start: certified.job.walrusStartEpoch, end: certified.job.walrusEndEpoch }
            : null,
        raw: certified.job,
        fallbackReason: memwalFailure ?? undefined,
      };
      tatumResult.evidence = buildWalrusEvidence(tatumResult, cfg);
      return tatumResult;
    }
    return { ok: false, transport: "tatum-storage-api", reason: certified.reason };
  } catch (err) {
    return {
      ok: false,
      transport: "tatum-storage-api",
      reason: err instanceof Error ? `WALRUS_WRITE_ERROR: ${err.message}` : "WALRUS_WRITE_ERROR",
    };
  }
}

/* --------------------------------- Read path ---------------------------------- */

export type WalrusRecallResult =
  | { ok: true; memories: Array<{ content: string; externalId?: string; blobId?: string; raw?: unknown }>; raw: unknown }
  | { ok: false; reason: string };

function scoreAgainstTerms(content: string, terms: string[]): number {
  const text = content.toLowerCase();
  let score = 0;
  for (const t of terms) if (t.length > 2 && text.includes(t)) score += 2;
  return score;
}

type RemoteMemory = { content: string; externalId?: string; blobId?: string; raw?: unknown };

/** Fetch the stored text of one memory job (patch URL from the job record, or via job status). */
async function fetchMemoryContent(job: WalrusJob, tatumWalrusJob: (id: string) => Promise<WalrusJob | null>): Promise<string | null> {
  try {
    let url = job.downloadUrlByQuiltPatchId ?? job.downloadUrlByQuiltId;
    if (!url && job.quiltPatchId) {
      url = `https://aggregator.walrus-mainnet.walrus.space/v1/blobs/by-quilt-patch-id/${job.quiltPatchId}`;
    }
    if (!url && job.status !== "CERTIFIED") return null;
    if (!url) {
      const full = await tatumWalrusJob(job.jobId);
      url = full?.downloadUrlByQuiltPatchId ?? full?.downloadUrlByQuiltId ?? undefined;
    }
    if (!url) return null;
    const text = await fetchFromAggregator(url);
    return text.trim().length > 0 ? text.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Remote recall with transport fallback:
 *   1. MemWal relayer — true semantic search (embedding distance) when authenticated.
 *   2. Tatum transport fallback — list certified recallos-mem-*.txt blobs (0 credits),
 *      read the newest few from the public aggregator, keyword-match the query
 *      (capped: 6 fetches, ~8s budget).
 * Local indexed recall in the memory service remains the primary retrieval path;
 * these merges only surface blobs known to Walrus but missing from the local index.
 */
export async function walrusRecall(query: string): Promise<WalrusRecallResult> {
  const cfg = await getWalrusConfigResolved();
  if (!cfg) return { ok: false, reason: "WALRUS_NO_TRANSPORT" };

  if (cfg.transport === "memwal-sdk") {
    const client = await loadMemWalClient(cfg);
    if (client) {
      try {
        const raw = await client.recall({ query, topK: 8, maxDistance: 0.8 });
        // The relayer has returned arrays, {results:[…]}, and {memories:[…]} across
        // API versions — accept every documented shape.
        const rawAny = raw as unknown as { results?: unknown[]; memories?: unknown[] } | unknown[];
        const list: any[] = Array.isArray(rawAny)
          ? rawAny
          : Array.isArray(rawAny?.results)
            ? rawAny.results
            : Array.isArray(rawAny?.memories)
              ? rawAny.memories
              : [];
        return {
          ok: true,
          memories: list
            .map((m) => ({
              content: String(m?.text ?? m?.content ?? m?.memory ?? "").trim(),
              externalId: m?.blob_id ?? m?.memory_id ?? m?.id ?? undefined,
              blobId: m?.blob_id ?? undefined,
              raw: m,
            }))
            .filter((m) => m.content.length > 0),
          raw: { total: raw?.total, dropped_count: raw?.dropped_count },
        };
      } catch (err) {
        noteMemwalFailure(err);
        console.warn("[walrus] MemWal recall failed (%s) — attempting Tatum fallback.", (memwalLastError ?? "").slice(0, 160));
      }
    }
  }

  // Tatum transport recall.
  const terms = query.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const deadline = Date.now() + 8_000;
  const MAX_FETCHES = 6;
  try {
    const { jobs } = await tatumWalrusListUploads(50, 0);
    const { tatumWalrusJob } = await import("@/lib/tatum/walrus");
    const memoryJobs = jobs
      .filter((j) => j.filename?.startsWith(MEMORY_FILE_PREFIX) && j.status === "CERTIFIED")
      .slice(0, MAX_FETCHES);
    const memories: RemoteMemory[] = [];
    let fetched = 0;
    for (const job of memoryJobs) {
      if (Date.now() > deadline || fetched >= MAX_FETCHES) break;
      const content = await fetchMemoryContent(job, tatumWalrusJob);
      if (content === null) continue;
      fetched += 1;
      if (terms.length === 0 || scoreAgainstTerms(content, terms) > 0) {
        memories.push({
          content,
          externalId: job.blobId ?? job.jobId,
          blobId: job.blobId,
          raw: job,
        });
      }
    }
    return { ok: true, memories, raw: { listed: jobs.length, fetched } };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? `WALRUS_RECALL_ERROR: ${err.message}` : "WALRUS_RECALL_ERROR",
    };
  }
}

/* --------------------------------- Live probe --------------------------------- */

type ProbeCache = { at: number; ok: boolean; detail: string | null; source: WalrusConfigSource | null };
let probeCache: ProbeCache | null = null;
const PROBE_TTL_OK = 60_000; // success cached 60s (cheap endpoint, avoid hammering)

/**
 * Live probe — honest per transport:
 *   · memwal-sdk: an AUTHENTICATED call (listMemories, limit 1). health() is
 *     unauthenticated and would report "ok" even with a bad delegate key.
 *   · tatum-storage-api: GET /v4/data/storage/uploads (0 credits). A 200 proves
 *     the key authenticates against the Walrus Storage API right now.
 */
export async function probeWalrusLive(): Promise<{ ok: boolean; detail: string | null; source: WalrusConfigSource | null }> {
  const now = Date.now();
  if (probeCache && probeCache.ok && now - probeCache.at < PROBE_TTL_OK) {
    return { ok: true, detail: probeCache.detail, source: probeCache.source };
  }
  const cfg = await getWalrusConfigResolved();
  if (!cfg) return { ok: false, detail: "no transport configured", source: null };
  const okReturn = (detail: string | null) => ({ ok: true, detail, source: cfg.source });
  const failReturn = (detail: string | null) => ({ ok: false, detail, source: cfg.source });

  if (cfg.transport === "memwal-sdk") {
    const client = await loadMemWalClient(cfg);
    if (!client) {
      probeCache = { at: now, ok: false, detail: memwalLastError ?? "MemWal SDK failed to load", source: cfg.source };
      return failReturn(probeCache.detail);
    }
    try {
      await client.listMemories({ limit: 1 });
      probeCache = { at: now, ok: true, detail: `relayer auth ok (${cfg.serverUrl})`, source: cfg.source };
      return okReturn(probeCache.detail);
    } catch (err) {
      probeCache = {
        at: now,
        ok: false,
        detail: err instanceof Error ? err.message.slice(0, 220) : String(err),
        source: cfg.source,
      };
      return failReturn(probeCache.detail);
    }
  }

  try {
    const { total } = await tatumWalrusListUploads(1, 0);
    probeCache = { at: now, ok: true, detail: `list ok (${total} job${total === 1 ? "" : "s"})`, source: cfg.source };
    return okReturn(probeCache.detail);
  } catch (err) {
    probeCache = { at: now, ok: false, detail: err instanceof Error ? err.message : String(err), source: cfg.source };
    return failReturn(probeCache.detail);
  }
}
