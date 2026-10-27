/**
 * Tatum Sui service — REAL blockchain data integration.
 *
 * Verified interface (live-tested against the gateway, 2026-10):
 *   - Gateway:  https://sui-mainnet-grpc.gateway.tatum.io   (TLS, port 443)
 *   - Auth:     gRPC metadata `x-api-key: <TATUM_API_KEY>` (server-side only)
 *   - Protocol: Sui gRPC — Protocol Buffers over HTTP/2 (see src/lib/tatum/grpc.ts)
 *
 * Why gRPC: the Sui Foundation deprecated legacy JSON-RPC across the ecosystem
 * in favor of gRPC and GraphQL, and Tatum transitioned its Sui infrastructure
 * to the Sui gRPC gateway (https://docs.tatum.io/reference/sui-grpc). All
 * full-node reads below run on the gRPC LedgerService/StateService with the
 * official Sui protos vendored at vendor/sui-grpc-proto.
 *
 * Every observation stores the exact operation + parameters used so provenance
 * stays auditable.
 */

import { randomUUID } from "crypto";
import { getTatumConfigResolved, tatumNetwork } from "./config";
import { TatumError } from "./errors";
import {
  getLatestCheckpoint,
  getSuiBalance,
  getServiceInfo,
  getTransactionByDigest,
  listAllBalances,
  listOwnedObjectsPage,
} from "./grpc";

export { TatumError };

export type SuiNetwork = "mainnet" | "testnet" | "devnet";

export function gatewayFor(network: SuiNetwork): string {
  return `https://sui-${network}-grpc.gateway.tatum.io`;
}

/* ------------------------------------------------------------------ */
/* Normalized observation types                                        */
/* ------------------------------------------------------------------ */

export type NormalizedObservation = {
  kind: "CHECKPOINT" | "TRANSACTION" | "BALANCE" | "OWNED_OBJECTS";
  method: string;
  params: Record<string, unknown>;
  network: SuiNetwork;
  sourceRef: string;
  latencyMs: number;
  observedAt: string;
  result: Record<string, unknown>;
};

function sourceRef(op: string, ref?: string): string {
  return `tatum:sui-grpc:${op}${ref ? `:${ref}` : ""}`;
}

function network(): SuiNetwork {
  return (process.env.TATUM_SUI_NETWORK as SuiNetwork) || "mainnet";
}

/** Resolve the active key once for an observation (Settings-saved → .env). */
async function activeKey(): Promise<string> {
  const cfg = await getTatumConfigResolved();
  if (!cfg?.apiKey) {
    throw new TatumError("TATUM_NOT_CONFIGURED", "No Tatum API key is active (save one in Settings or set TATUM_API_KEY)");
  }
  return cfg.apiKey;
}

/* ------------------------------------------------------------------ */
/* gRPC operations (mapped to the official sui/rpc/v2 services)         */
/* ------------------------------------------------------------------ */

export async function observeCheckpoint(): Promise<NormalizedObservation> {
  const start = Date.now();
  const apiKey = await activeKey();
  const net = network();
  const [info, latest] = await Promise.all([
    getServiceInfo(apiKey, net),
    getLatestCheckpoint(apiKey, net),
  ]);
  return {
    kind: "CHECKPOINT",
    method: "grpc:ledgerService.getCheckpoint(latest)",
    params: { service: "LedgerService.GetCheckpoint", transport: "sui-grpc" },
    network: net,
    sourceRef: sourceRef("getCheckpoint", latest.digest),
    latencyMs: Date.now() - start,
    observedAt: new Date().toISOString(),
    result: {
      chain: info.chain,
      chainId: info.chainId,
      epoch: info.epoch,
      latestCheckpoint: {
        sequenceNumber: latest.sequenceNumber,
        digest: latest.digest,
        timestamp: latest.timestamp,
      },
    },
  };
}

export async function observeTransaction(digest: string): Promise<NormalizedObservation> {
  if (!/^[-A-Za-z0-9]{8,80}$/.test(digest)) {
    throw new TatumError("INVALID_INPUT", "digest must be a base58-like transaction digest");
  }
  const start = Date.now();
  const apiKey = await activeKey();
  const net = network();
  const tx = await getTransactionByDigest(digest, apiKey, net);
  return {
    kind: "TRANSACTION",
    method: "grpc:ledgerService.getTransaction",
    params: { digest, transport: "sui-grpc" },
    network: net,
    sourceRef: sourceRef("getTransaction", digest),
    latencyMs: Date.now() - start,
    observedAt: new Date().toISOString(),
    result: {
      digest: tx.digest,
      sender: tx.sender,
      status: tx.status,
      timestamp: tx.timestamp,
      balanceChanges: tx.balanceChanges,
    },
  };
}

export async function observeBalance(address: string): Promise<NormalizedObservation> {
  if (!/^0x[a-fA-F0-9]{4,64}$/.test(address)) {
    throw new TatumError("INVALID_INPUT", "address must be a 0x-prefixed hex Sui address");
  }
  const start = Date.now();
  const apiKey = await activeKey();
  const net = network();
  const [sui, balances] = await Promise.all([
    getSuiBalance(address, apiKey, net),
    listAllBalances(address, apiKey, net, 12),
  ]);
  return {
    kind: "BALANCE",
    method: "grpc:stateService.getBalance",
    params: { address, coinType: "0x2::sui::SUI", transport: "sui-grpc" },
    network: net,
    sourceRef: sourceRef("getBalance", address),
    latencyMs: Date.now() - start,
    observedAt: new Date().toISOString(),
    result: {
      address,
      suiTotalBalance: sui.balance,
      balances: balances.map((b) => ({ coinType: b.coinType, totalBalance: b.balance })),
    },
  };
}

export async function observeOwnedObjects(address: string): Promise<NormalizedObservation> {
  if (!/^0x[a-fA-F0-9]{4,64}$/.test(address)) {
    throw new TatumError("INVALID_INPUT", "address must be a 0x-prefixed hex Sui address");
  }
  const start = Date.now();
  const apiKey = await activeKey();
  const net = network();
  const { objects, hasMore } = await listOwnedObjectsPage(address, apiKey, net, 10);
  return {
    kind: "OWNED_OBJECTS",
    method: "grpc:stateService.listOwnedObjects",
    params: { address, limit: 10, transport: "sui-grpc" },
    network: net,
    sourceRef: sourceRef("listOwnedObjects", address),
    latencyMs: Date.now() - start,
    observedAt: new Date().toISOString(),
    result: {
      address,
      objects: objects.map((o) => ({
        objectAddress: o.objectId,
        version: o.version,
        digest: o.digest,
        hasPublicTransfer: o.hasPublicTransfer,
        type: o.objectType,
      })),
      hasMore,
    },
  };
}

/** Lightweight auth/reachability probe used by /api/settings/test — a real authenticated GetServiceInfo call. */
export async function pingTatum(): Promise<{ ok: boolean; detail: string }> {
  const cfg = await getTatumConfigResolved();
  if (!cfg) return { ok: false, detail: "no Tatum API key active (save one in Settings or set TATUM_API_KEY)" };
  return pingTatumWithKey(cfg.apiKey);
}

/** Probe with an EXPLICIT key — used by the Settings test endpoint; never saved, never logged. */
export async function pingTatumWithKey(apiKey: string): Promise<{
  ok: boolean;
  detail: string;
  chainIdentifier?: string;
  chain?: string;
  epoch?: string;
  checkpointHeight?: string;
  gateway?: string;
}> {
  const { pingGrpcGateway } = await import("./grpc");
  const net = tatumNetwork();
  const probe = await pingGrpcGateway(apiKey, net);
  return {
    ok: probe.ok,
    detail: probe.ok ? `chain ${probe.chainId} · sui ${probe.chain} · epoch ${probe.epoch} · checkpoint ${probe.checkpointHeight}` : probe.detail,
    chainIdentifier: probe.chainId,
    chain: probe.chain,
    epoch: probe.epoch,
    checkpointHeight: probe.checkpointHeight,
    gateway: gatewayFor(net),
  };
}

export function observationId(): string {
  return randomUUID();
}
