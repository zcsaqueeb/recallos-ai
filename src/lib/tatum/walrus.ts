/**
 * Tatum Walrus Storage API client — REAL Walrus mainnet persistence.
 *
 * Verified live (2026-10, key-tested end to end):
 *   1. POST https://api.tatum.io/v4/data/storage/upload   (multipart field `file`)
 *      → 201 { jobId, status: "PENDING", filename, mimeType, sizeBytes, blobId }
 *      Billed via Walrus on-chain storage fees — no standard API credits per call.
 *      Max file size 50 MiB. Mainnet keys only.
 *   2. GET  https://api.tatum.io/v4/data/storage/upload/{jobId}
 *      → lifecycle PENDING → UPLOADING → CERTIFIED | FAILED
 *      CERTIFIED adds: quiltPatchId, suiObjectId, walrusStartEpoch/EndEpoch,
 *      downloadUrlByQuiltId / downloadUrlByQuiltPatchId, storageEvents (tx digests).
 *   3. GET  https://api.tatum.io/v4/data/storage/uploads?limit&offset
 *      → 200 { jobs: [...] } (0 credits) — used as the health probe + recall index.
 *   4. Read-back: downloadUrlByQuiltPatchId on aggregator.walrus-mainnet.walrus.space
 *      returns the exact original bytes (verified) — used to prove retrievability.
 *
 * Storage window defaults to ~4 epochs (~8 weeks) and is automatically renewed by
 * Tatum; DELETE /v4/data/storage/upload/{jobId} cancels renewal (not used by
 * memories — memories are meant to persist).
 *
 * Docs: https://docs.tatum.io/reference/storageupload.md (+ storagegetuploadstatus,
 * storagelistuploads). Auth: x-api-key header, server-side only.
 */

export type WalrusJobStatus = "PENDING" | "UPLOADING" | "CERTIFIED" | "FAILED";

export type WalrusJob = {
  jobId: string;
  status: WalrusJobStatus;
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
  blobId?: string;
  quiltPatchId?: string;
  suiObjectId?: string;
  walrusStartEpoch?: number;
  walrusEndEpoch?: number;
  renewalBillingStatus?: string;
  errorMessage?: string;
  downloadUrlByQuiltId?: string;
  downloadUrlByQuiltPatchId?: string;
  storageEvents?: Array<{ type: string; txDigest: string; at: number; epochs?: number }>;
  createdAt?: number;
  updatedAt?: number;
};

export class TatumWalrusError extends Error {
  code: string;
  constructor(code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

/**
 * Parse a Walrus gateway JSON body. A non-JSON body (proxy/CDN HTML error
 * page between us and Tatum) must surface as a typed TatumWalrusError —
 * never as a raw `Unexpected token '<'` JSON parser message leaking into
 * scenario details or UI disclosure strings.
 */
async function walrusJson<T = unknown>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new TatumWalrusError("TATUM_MALFORMED_RESPONSE", `HTTP ${res.status} body was not valid JSON`);
  }
}

const WALRUS_TIMEOUT_MS = Number(process.env.TATUM_TIMEOUT_MS || 12_000);

async function requireKey(): Promise<string> {
  // Settings-saved key → .env (src/lib/tatum/config.ts). Resolved per call so a
  // key saved/removed in Settings goes live on the very next transport call.
  const { getTatumConfigResolved } = await import("./config");
  const key = (await getTatumConfigResolved())?.apiKey ?? null;
  if (!key) throw new TatumWalrusError("TATUM_NOT_CONFIGURED", "No Tatum API key is active (save one in Settings or set TATUM_API_KEY)");
  return key;
}

async function walrusFetch(path: string, init?: RequestInit): Promise<Response> {
  const key = await requireKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WALRUS_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.tatum.io${path}`, {
      ...init,
      headers: {
        "x-api-key": key,
        accept: "application/json",
        ...(init?.headers ?? {}),
      },
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      throw new TatumWalrusError("TATUM_AUTH_FAILED", `HTTP ${res.status} on ${path}`);
    }
    if (res.status === 429) {
      throw new TatumWalrusError("TATUM_RATE_LIMITED", "Provider rate limit reached");
    }
    if (!res.ok && res.status !== 404) {
      const body = await res.text().catch(() => "");
      throw new TatumWalrusError("TATUM_HTTP_ERROR", `HTTP ${res.status} ${body.slice(0, 200)}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** Stage a memory blob for Walrus storage. Returns immediately with jobId + pre-computed blobId. */
export async function tatumWalrusUpload(content: Buffer, filename: string): Promise<WalrusJob> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(content)], { type: "text/plain" }), filename);
  const res = await walrusFetch("/v4/data/storage/upload", { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new TatumWalrusError("TATUM_UPLOAD_REJECTED", `HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return walrusJson<WalrusJob>(res);
}

/** Poll one upload job. 404 → FAILED (unknown job). */
export async function tatumWalrusJob(jobId: string): Promise<WalrusJob | null> {
  const res = await walrusFetch(`/v4/data/storage/upload/${encodeURIComponent(jobId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new TatumWalrusError("TATUM_HTTP_ERROR", `HTTP ${res.status} on job status`);
  return walrusJson<WalrusJob>(res);
}

export type WalrusUploadList = { jobs: WalrusJob[]; total: number };

/** List upload jobs for this API key, newest first (0 credits). */
export async function tatumWalrusListUploads(limit = 50, offset = 0): Promise<WalrusUploadList> {
  const res = await walrusFetch(`/v4/data/storage/uploads?limit=${limit}&offset=${offset}`);
  if (!res.ok) throw new TatumWalrusError("TATUM_HTTP_ERROR", `HTTP ${res.status} on list uploads`);
  const json: any = await walrusJson<unknown>(res);
  // The endpoint returns either { jobs, total } or a bare array depending on version — accept both.
  const jobs: WalrusJob[] = Array.isArray(json) ? json : Array.isArray(json?.jobs) ? json.jobs : [];
  return { jobs, total: Number(json?.total ?? jobs.length) };
}

export type WalrusCertifyResult =
  | { ok: true; job: WalrusJob }
  | { ok: false; reason: string; job: WalrusJob | null };

/**
 * Wait until the upload reaches CERTIFIED (or FAILED / timeout).
 * Certification is an on-chain event: register tx + certify tx on Sui —
 * observed live at ~12s for a small blob. Budget generously (60s).
 */
export async function waitForWalrusCertification(
  jobId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<WalrusCertifyResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const intervalMs = opts.intervalMs ?? 4_000;
  const deadline = Date.now() + timeoutMs;
  let last: WalrusJob | null = null;
  while (Date.now() < deadline) {
    const job = await tatumWalrusJob(jobId);
    if (job) {
      last = job;
      if (job.status === "CERTIFIED") return { ok: true, job };
      if (job.status === "FAILED") return { ok: false, reason: job.errorMessage || "WALRUS_JOB_FAILED", job };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { ok: false, reason: "WALRUS_CERTIFICATION_TIMEOUT", job: last };
}

/** Read a certified blob back from the public Walrus mainnet aggregator (no key, free). */
export async function fetchFromAggregator(url: string, timeoutMs = 8_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: "text/plain, */*" } });
    if (!res.ok) throw new TatumWalrusError("AGGREGATOR_HTTP_ERROR", `HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}
