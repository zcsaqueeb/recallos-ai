/**
 * Tatum credential resolution — Settings UI saved key → .env fallback.
 *
 * Mirrors getWalrusConfigResolved() in src/lib/memory/walrus-client.ts:
 *   1. AppSettings singleton row — an API key saved through the Settings UI
 *      ("Tatum — Sui gateway" card) by the operator/user of this deployment.
 *   2. Server .env (TATUM_API_KEY) — the built-in fallback.
 *
 * Every Tatum call site (Sui gRPC full-node reads, Walrus Storage API transport,
 * live probes) resolves the key through this module, so a saved key is live
 * immediately and removing it instantly reverts to .env — nothing is cached at
 * the key level.
 */

import { db } from "@/lib/db";
import { grpcGatewayUrl } from "./grpc";
import type { SuiNetwork } from "./client";

export type TatumConfigSource = "custom" | "env";

export type ResolvedTatumConfig = {
  apiKey: string;
  network: SuiNetwork;
  gatewayUrl: string;
  source: TatumConfigSource;
};

export function tatumNetwork(): SuiNetwork {
  return (process.env.TATUM_SUI_NETWORK as SuiNetwork) || "mainnet";
}

export function envTatumApiKey(): string | null {
  return process.env.TATUM_API_KEY || null;
}

/** ENV-ONLY lookup (sync) — used by legacy callers that cannot await. */
export function getTatumEnvStatus(): { configured: boolean; network: SuiNetwork; gatewayUrl: string | null } {
  const configured = Boolean(envTatumApiKey());
  const network = tatumNetwork();
  return { configured, network, gatewayUrl: configured ? grpcGatewayUrl(network) : null };
}

/**
 * Credential resolution order:
 *   1. tatumApiKey saved in AppSettings (Settings UI).
 *   2. Server .env TATUM_API_KEY.
 * Returns null when neither layer has a key.
 */
export async function getTatumConfigResolved(): Promise<ResolvedTatumConfig | null> {
  let custom: string | null = null;
  try {
    const s = await db.appSettings.findUnique({ where: { id: "singleton" }, select: { tatumApiKey: true } });
    custom = s?.tatumApiKey?.trim() || null;
  } catch {
    // Settings table unavailable — fall through to env.
  }
  const network = tatumNetwork();
  const gatewayUrl = grpcGatewayUrl(network);
  if (custom) return { apiKey: custom, network, gatewayUrl, source: "custom" };
  const envKey = envTatumApiKey();
  if (envKey) return { apiKey: envKey, network, gatewayUrl, source: "env" };
  return null;
}

export type TatumStatusFull = {
  configured: boolean;
  network: SuiNetwork;
  gatewayUrl: string | null;
  /** Which key is active right now: saved via the Settings UI ("custom") or server .env ("env"). */
  source: TatumConfigSource | null;
  /** True when an API key saved through the Settings UI is currently in force. */
  customSaved: boolean;
  /** True when a TATUM_API_KEY exists in .env as a fallback layer. */
  envFallbackAvailable: boolean;
  /** True when TATUM_SUI_NETWORK is explicitly set in the environment (vs. the mainnet default). */
  networkEnvSet: boolean;
};

export async function getTatumStatus(): Promise<TatumStatusFull> {
  const cfg = await getTatumConfigResolved();
  return {
    configured: cfg !== null,
    network: tatumNetwork(),
    gatewayUrl: cfg?.gatewayUrl ?? null,
    source: cfg?.source ?? null,
    customSaved: cfg?.source === "custom",
    envFallbackAvailable: Boolean(envTatumApiKey()),
    networkEnvSet: Boolean(process.env.TATUM_SUI_NETWORK?.trim()),
  };
}
