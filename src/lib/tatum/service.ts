/**
 * ChainLens service layer: performs observations via the real Tatum gateway.
 * When the gateway is not configured, the query fails with a NOT_CONFIGURED
 * error instead of ever returning synthetic data — nothing is invented.
 */

import { db } from "@/lib/db";
import { chainQuerySchema } from "@/lib/validation";
import {
  observeBalance,
  observeCheckpoint,
  observeOwnedObjects,
  observeTransaction,
  TatumError,
  type NormalizedObservation,
} from "./client";
import { getTatumStatus } from "./config";

export type ChainLensResponse =
  | { mode: "LIVE"; observation: NormalizedObservation; interpretationNote: string }
  | { mode: "ERROR"; error: string; detail?: string };

export async function runChainQuery(input: unknown, userId: string): Promise<ChainLensResponse> {
  const parsed = chainQuerySchema.safeParse(input);
  if (!parsed.success) {
    return { mode: "ERROR", error: "INVALID_INPUT", detail: parsed.error.issues[0]?.message };
  }
  const { kind, ref, address } = parsed.data;

  const status = await getTatumStatus();
  if (status.configured) {
    try {
      let observation: NormalizedObservation;
      if (kind === "CHECKPOINT") {
        observation = await observeCheckpoint();
      } else if (kind === "TRANSACTION") {
        if (!ref) return { mode: "ERROR", error: "INVALID_INPUT", detail: "transaction digest required" };
        observation = await observeTransaction(ref);
      } else if (kind === "BALANCE") {
        if (!address) return { mode: "ERROR", error: "INVALID_INPUT", detail: "address required" };
        observation = await observeBalance(address);
      } else {
        if (!address) return { mode: "ERROR", error: "INVALID_INPUT", detail: "address required" };
        observation = await observeOwnedObjects(address);
      }
      await db.chainObservation.create({
        data: {
          kind: observation.kind,
          method: observation.method,
          paramsJson: JSON.stringify(observation.params),
          resultJson: JSON.stringify(observation.result),
          network: observation.network,
          sourceRef: observation.sourceRef,
          latencyMs: observation.latencyMs,
        },
      });
      await db.activityEvent.create({
        data: {
          userId,
          kind: "CHAIN_OBSERVATION",
          summary: `Live Sui observation via Tatum (${observation.kind})`,
          metaJson: JSON.stringify({ sourceRef: observation.sourceRef }),
        },
      });
      return {
        mode: "LIVE",
        observation,
        interpretationNote:
          "Observation is raw on-chain data retrieved via Tatum. Activity does not prove quality, legitimacy, or future performance.",
      };
    } catch (err) {
      if (err instanceof TatumError) {
        return { mode: "ERROR", error: err.code, detail: err.detail };
      }
      return { mode: "ERROR", error: "UNKNOWN", detail: (err as Error).message };
    }
  }

  // Unconfigured → production behavior: fail honestly, never invent data.
  return {
    mode: "ERROR",
    error: "NOT_CONFIGURED",
    detail:
      "No Tatum API key is active. Save your key in Settings → “Tatum — Sui gateway” (or set TATUM_API_KEY in .env) to observe the live Sui network.",
  };
}

export async function recentObservations(limit = 12) {
  return db.chainObservation.findMany({ orderBy: { observedAt: "desc" }, take: limit });
}
