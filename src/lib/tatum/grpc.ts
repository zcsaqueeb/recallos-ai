/**
 * Tatum Sui gRPC transport — REAL full-node data via the Sui gRPC protocol.
 *
 * Why gRPC: the Sui Foundation deprecated legacy JSON-RPC across the ecosystem
 * in favor of gRPC and GraphQL, and Tatum transitioned its Sui infrastructure
 * to the dedicated Sui gRPC gateway (https://docs.tatum.io/reference/sui-grpc).
 * This module is RECALLOS's single full-node data plane.
 *
 *   - Gateway:  https://sui-mainnet-grpc.gateway.tatum.io   (TLS, port 443)
 *   - Auth:     gRPC metadata `x-api-key: <TATUM_API_KEY>` (same key as the
 *               old JSON-RPC/GraphQL gateway — resolved per call through
 *               src/lib/tatum/config.ts: Settings-saved → .env)
 *   - Protocol: Protocol Buffers over HTTP/2 (@grpc/grpc-js + @grpc/proto-loader)
 *   - Contracts: official Sui protos vendored at vendor/sui-grpc-proto
 *               (MystenLabs/sui-apis, sui/rpc/v2/*: LedgerService, StateService)
 *
 * Live-verified against the real mainnet gateway (2026-10, see
 * scripts/smoke-grpc.ts): GetServiceInfo / GetCheckpoint / GetBalance /
 * ListBalances / ListOwnedObjects return genuine chain data in 47–220 ms.
 *
 * proto-loader conventions used here:
 *   - request fields are camelCase (keepCase: false), e.g. `coinType`, `readMask`
 *   - FieldMask read masks are plain objects `{ paths: [...] }` whose paths use
 *     the canonical proto field names (snake_case), e.g. "summary.timestamp"
 *   - uint64 fields arrive as strings (longs: String) — JSON-safe by design
 *   - oneof virtual members appear as `_field` mirror keys — stripped before
 *     anything is stored or surfaced
 */

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import { TatumError, TATUM_TIMEOUT_MS } from "./errors";
import type { SuiNetwork } from "./client";

const TIMEOUT_MS = TATUM_TIMEOUT_MS;

/** Vendored official Sui proto tree (MystenLabs/sui-apis). Tracked in next.config outputFileTracingIncludes. */
const PROTO_ROOT = path.join(process.cwd(), "vendor", "sui-grpc-proto");

type GrpcMethod = (request: Record<string, unknown>, metadata: grpc.Metadata, options: { deadline: number }, callback: (err: grpc.ServiceError | null, res: unknown) => void) => unknown;
type GrpcClientCtor = new (authority: string, creds: grpc.ChannelCredentials) => Record<string, GrpcMethod>;
type GrpcClient = Record<string, GrpcMethod>;

let protoPromise: Promise<{ LedgerService: GrpcClientCtor; StateService: GrpcClientCtor }> | null = null;

async function loadSuiProtos(): Promise<{ LedgerService: GrpcClientCtor; StateService: GrpcClientCtor }> {
  if (!protoPromise) {
    protoPromise = (async () => {
      const opts: protoLoader.Options = {
        includeDirs: [PROTO_ROOT],
        keepCase: false,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      };
      const ledgerDef = await protoLoader.load("sui/rpc/v2/ledger_service.proto", opts);
      const ledgerPkg = grpc.loadPackageDefinition(ledgerDef) as any;
      const stateDef = await protoLoader.load("sui/rpc/v2/state_service.proto", opts);
      const statePkg = grpc.loadPackageDefinition(stateDef) as any;
      const LedgerService = ledgerPkg?.sui?.rpc?.v2?.LedgerService;
      const StateService = statePkg?.sui?.rpc?.v2?.StateService;
      if (typeof LedgerService !== "function" || typeof StateService !== "function") {
        throw new Error("Sui gRPC protos failed to load (LedgerService/StateService missing)");
      }
      return { LedgerService: LedgerService as unknown as GrpcClientCtor, StateService: StateService as unknown as GrpcClientCtor };
    })().catch((err) => {
      protoPromise = null; // allow retry on the next call
      throw err;
    });
  }
  return protoPromise;
}

/** gRPC authority (host:port) for a Sui network on Tatum's gRPC gateway. */
export function grpcAuthority(network: SuiNetwork): string {
  return `sui-${network}-grpc.gateway.tatum.io:443`;
}

/** Public https URL of the gRPC gateway (display/provenance only). */
export function grpcGatewayUrl(network: SuiNetwork): string {
  return `https://sui-${network}-grpc.gateway.tatum.io`;
}

/** Clients are cached per authority; the API key travels per-call in metadata, never in the cache. */
const clientCache = new Map<string, { ledger: GrpcClient; state: GrpcClient }>();

async function clients(network: SuiNetwork): Promise<{ ledger: GrpcClient; state: GrpcClient }> {
  const authority = grpcAuthority(network);
  const cached = clientCache.get(authority);
  if (cached) return cached;
  const { LedgerService, StateService } = await loadSuiProtos();
  const creds = grpc.credentials.createSsl();
  const entry = {
    ledger: new LedgerService(authority, creds),
    state: new StateService(authority, creds),
  };
  clientCache.set(authority, entry);
  return entry;
}

function metadataWithKey(apiKey: string): grpc.Metadata {
  const meta = new grpc.Metadata();
  meta.set("x-api-key", apiKey);
  return meta;
}

function mapGrpcError(err: grpc.ServiceError, what: string): TatumError {
  const code = err.code;
  const detail = String(err.details ?? err.message ?? "gRPC call failed").slice(0, 300);
  if (code === grpc.status.UNAUTHENTICATED || code === grpc.status.PERMISSION_DENIED) {
    return new TatumError("TATUM_AUTH_FAILED", "Invalid or unauthorized API key");
  }
  if (code === grpc.status.RESOURCE_EXHAUSTED) {
    return new TatumError("TATUM_RATE_LIMITED", "Provider rate limit reached; retry later");
  }
  if (code === grpc.status.DEADLINE_EXCEEDED) {
    return new TatumError("TATUM_TIMEOUT", `${what} timed out after ${TIMEOUT_MS}ms`);
  }
  if (code === grpc.status.NOT_FOUND) {
    return new TatumError("NOT_FOUND", detail);
  }
  if (code === grpc.status.INVALID_ARGUMENT) {
    return new TatumError("INVALID_INPUT", detail);
  }
  if (code === grpc.status.UNAVAILABLE) {
    return new TatumError("TATUM_NETWORK_ERROR", `gateway unavailable: ${detail}`);
  }
  return new TatumError("TATUM_GRPC_ERROR", `${what}: ${detail}`);
}

/** One authenticated unary gRPC call with a hard deadline. */
async function grpcCall<R = any>(
  client: GrpcClient,
  method: string,
  request: Record<string, unknown>,
  apiKey: string,
  what: string,
): Promise<R> {
  const deadline = Date.now() + TIMEOUT_MS;
  return new Promise<R>((resolve, reject) => {
    (client as any)[method](request, metadataWithKey(apiKey), { deadline }, (err: grpc.ServiceError | null, res: R) => {
      if (err) {
        reject(err instanceof Error && "code" in err ? mapGrpcError(err as grpc.ServiceError, what) : new TatumError("TATUM_GRPC_ERROR", `${what}: ${(err as Error).message}`));
      } else {
        resolve(res);
      }
    });
  });
}

/** Strip proto-loader's `_field` oneof mirror keys so stored JSON stays clean. */
export function cleanProto<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cleanProto) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k.startsWith("_")) continue;
      out[k] = cleanProto(v);
    }
    return out as T;
  }
  return value;
}

/** google.protobuf.Timestamp ({seconds, nanos}) → ISO string (ms precision). */
function timestampToIso(ts: { seconds?: string | number; nanos?: number } | null | undefined): string | null {
  if (!ts || ts.seconds === undefined || ts.seconds === null) return null;
  const ms = Number(ts.seconds) * 1000 + Math.floor((ts.nanos ?? 0) / 1_000_000);
  return new Date(ms).toISOString();
}

/* ------------------------------------------------------------------ */
/* Typed operations (all take the EXPLICIT key — resolved by caller)   */
/* ------------------------------------------------------------------ */

export type ServiceInfo = {
  chainId: string;
  chain: string;
  epoch: string;
  checkpointHeight: string;
  timestamp: string | null;
};

export async function getServiceInfo(apiKey: string, network: SuiNetwork): Promise<ServiceInfo> {
  const { ledger } = await clients(network);
  const res = await grpcCall(ledger, "getServiceInfo", {}, apiKey, "GetServiceInfo");
  const info = cleanProto(res ?? {});
  return {
    chainId: String(info.chainId ?? ""),
    chain: String(info.chain ?? network),
    epoch: String(info.epoch ?? "0"),
    checkpointHeight: String(info.checkpointHeight ?? "0"),
    timestamp: timestampToIso(info.timestamp),
  };
}

export type LatestCheckpoint = {
  sequenceNumber: string;
  digest: string;
  epoch: string;
  timestamp: string | null;
};

export async function getLatestCheckpoint(apiKey: string, network: SuiNetwork): Promise<LatestCheckpoint> {
  const { ledger } = await clients(network);
  // No checkpoint_id → the gateway returns the LATEST checkpoint.
  const res = await grpcCall(
    ledger,
    "getCheckpoint",
    { readMask: { paths: ["sequence_number", "digest", "summary.epoch", "summary.timestamp"] } },
    apiKey,
    "GetCheckpoint",
  );
  const cp = cleanProto((res as any)?.checkpoint ?? {});
  if (!cp.digest && !cp.sequenceNumber) {
    throw new TatumError("TATUM_GRPC_ERROR", "GetCheckpoint returned an empty checkpoint");
  }
  return {
    sequenceNumber: String(cp.sequenceNumber ?? "0"),
    digest: String(cp.digest ?? ""),
    epoch: String(cp.summary?.epoch ?? "0"),
    timestamp: timestampToIso(cp.summary?.timestamp),
  };
}

export type GrpcTransaction = {
  digest: string;
  sender: string | null;
  status: string | null;
  timestamp: string | null;
  balanceChanges: Array<{ amount: string; coinType: string; owner: string | null }>;
};

export async function getTransactionByDigest(digest: string, apiKey: string, network: SuiNetwork): Promise<GrpcTransaction> {
  const { ledger } = await clients(network);
  const res = await grpcCall(
    ledger,
    "getTransaction",
    {
      digest,
      readMask: { paths: ["digest", "transaction.sender", "effects.status", "timestamp", "balance_changes"] },
    },
    apiKey,
    "GetTransaction",
  );
  const tx = cleanProto((res as any)?.transaction ?? {});
  if (!tx.digest) {
    throw new TatumError("NOT_FOUND", `transaction ${digest} does not exist on ${network}`);
  }
  // effects.status shape depends on the proto generation the gateway serves:
  // modern sui/rpc/v2 uses a message {success: bool, error?: …}, older builds
  // an enum string ("EXECUTION_STATUS_SUCCESS"). Normalize to a stable string
  // so clients never need to know the difference.
  const rawStatus = tx.effects?.status;
  let status: string | null = null;
  if (typeof rawStatus === "string" && rawStatus) {
    status = /SUCCESS|EXECUTED/i.test(rawStatus) ? "SUCCESS" : /FAIL|ABORT|ERROR/i.test(rawStatus) ? "FAILURE" : rawStatus.toUpperCase();
  } else if (rawStatus && typeof rawStatus === "object") {
    const s = rawStatus as Record<string, unknown>;
    if (s.success === true) status = "SUCCESS";
    else if (s.success === false) status = "FAILURE";
  }
  return {
    digest: String(tx.digest),
    sender: tx.transaction?.sender ?? null,
    status,
    timestamp: timestampToIso(tx.timestamp),
    balanceChanges: (tx.balanceChanges ?? []).map((b: any) => ({
      amount: String(b.amount ?? "0"),
      coinType: String(b.coinType ?? ""),
      owner: b.address ?? null,
    })),
  };
}

export type GrpcBalance = { coinType: string; balance: string };

export async function getSuiBalance(owner: string, apiKey: string, network: SuiNetwork): Promise<GrpcBalance> {
  const { state } = await clients(network);
  const res = await grpcCall(state, "getBalance", { owner, coinType: "0x2::sui::SUI" }, apiKey, "GetBalance");
  const bal = cleanProto((res as any)?.balance ?? {});
  return { coinType: String(bal.coinType ?? "0x2::sui::SUI"), balance: String(bal.balance ?? "0") };
}

export async function listAllBalances(owner: string, apiKey: string, network: SuiNetwork, pageSize = 12): Promise<GrpcBalance[]> {
  const { state } = await clients(network);
  const res = await grpcCall(state, "listBalances", { owner, pageSize }, apiKey, "ListBalances");
  return cleanProto((res as any)?.balances ?? []).map((b: any) => ({
    coinType: String(b.coinType ?? ""),
    balance: String(b.balance ?? "0"),
  }));
}

export type GrpcOwnedObject = {
  objectId: string;
  version: string;
  digest: string | null;
  objectType: string | null;
  hasPublicTransfer: boolean | null;
};

export async function listOwnedObjectsPage(
  owner: string,
  apiKey: string,
  network: SuiNetwork,
  pageSize = 10,
): Promise<{ objects: GrpcOwnedObject[]; hasMore: boolean }> {
  const { state } = await clients(network);
  const res = await grpcCall(
    state,
    "listOwnedObjects",
    {
      owner,
      pageSize,
      readMask: { paths: ["object_id", "version", "digest", "object_type", "has_public_transfer"] },
    },
    apiKey,
    "ListOwnedObjects",
  );
  const objects = cleanProto((res as any)?.objects ?? []).map((o: any) => ({
    objectId: String(o.objectId ?? ""),
    version: String(o.version ?? "0"),
    digest: o.digest ?? null,
    objectType: o.objectType ?? null,
    hasPublicTransfer: o.hasPublicTransfer ?? null,
  }));
  const token = (res as any)?.nextPageToken;
  const hasMore = Array.isArray(token) ? token.length > 0 : Boolean(token);
  return { objects, hasMore };
}

/** Light probe used by /api/settings/test + /api/status — proves the key authenticates on the gRPC gateway. */
export async function pingGrpcGateway(
  apiKey: string,
  network: SuiNetwork,
): Promise<{ ok: boolean; detail: string; chainId?: string; chain?: string; epoch?: string; checkpointHeight?: string }> {
  try {
    const info = await getServiceInfo(apiKey, network);
    return {
      ok: Boolean(info.chainId),
      detail: `chain ${info.chainId} (sui ${info.chain}) · epoch ${info.epoch} · checkpoint ${info.checkpointHeight}`,
      chainId: info.chainId,
      chain: info.chain,
      epoch: info.epoch,
      checkpointHeight: info.checkpointHeight,
    };
  } catch (err) {
    if (err instanceof TatumError) return { ok: false, detail: err.detail ? `${err.code} — ${err.detail}` : err.code };
    return { ok: false, detail: (err as Error).message };
  }
}
