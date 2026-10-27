import { NextResponse } from "next/server";
import { resolveWorkspaceUser } from "@/lib/workspace";
import { runChainQuery, recentObservations } from "@/lib/tatum/service";
import { observeCheckpoint, TatumError } from "@/lib/tatum/client";
import { getTatumStatus } from "@/lib/tatum/config";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { jsonNoStore } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/chainlens
 *   (no params) → newest stored observations (history).
 *   ?live=1      → a REAL live chain-tip probe (LedgerService.getCheckpoint
 *                  via the workspace's configured Tatum gateway) that is NOT
 *                  persisted — it powers the dashboard "Latest Sui observation"
 *                  tile so it always reflects the current chain tip, never a
 *                  stale stored snapshot. Falls back to history semantics on
 *                  any probe failure (tile keeps the newest stored row).
 */
export async function GET(req: Request) {
  try {
    await resolveWorkspaceUser();
    const url = new URL(req.url);
    if (url.searchParams.get("live") === "1") {
      // Light budget: dashboard polls this at most ~once a minute per client.
      const rl = rateLimit(clientKey(req, "chainlens-live"), 30, 60_000);
      if (!rl.allowed) return tooManyRequests(rl);
      const status = await getTatumStatus();
      if (!status.configured) {
        return jsonNoStore({ live: null, reason: "NOT_CONFIGURED" });
      }
      try {
        const observation = await observeCheckpoint();
        return jsonNoStore({
          live: {
            kind: observation.kind,
            result: observation.result,
            latencyMs: observation.latencyMs,
            observedAt: new Date().toISOString(),
          },
        });
      } catch (err) {
        // Honest fallback: a failed probe is reported, never invented.
        return jsonNoStore({
          live: null,
          reason: err instanceof TatumError ? err.code : "PROBE_FAILED",
        });
      }
    }
    const observations = await recentObservations();
    return jsonNoStore({ observations });
  } catch (err) {
    return jsonNoStore({ error: "CHAINLENS_GET_FAILED", detail: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const rl = rateLimit(clientKey(req, "chainlens"), 15, 60_000);
  if (!rl.allowed) return tooManyRequests(rl);
  try {
    const user = await resolveWorkspaceUser();
    const result = await runChainQuery(await req.json(), user.id);
    const status = result.mode === "ERROR" ? (result.error === "INVALID_INPUT" ? 400 : 502) : 200;
    return NextResponse.json(result, { status, headers: { "cache-control": "no-store, max-age=0" } });
  } catch (err) {
    return NextResponse.json(
      { error: "CHAINLENS_POST_FAILED", detail: (err as Error).message },
      { status: 500, headers: { "cache-control": "no-store, max-age=0" } },
    );
  }
}
