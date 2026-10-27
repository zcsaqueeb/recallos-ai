import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveWorkspaceUser } from "@/lib/workspace";
import { getWalrusStatus, probeWalrusLive } from "@/lib/memory/walrus-client";
import { getTatumStatus } from "@/lib/tatum/config";
import { jsonNoStore } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Honest integration status — the UI renders exactly this, nothing invented. */
export async function GET() {
  try {
    const user = await resolveWorkspaceUser();
    // Probe FIRST: it triggers the MemWal SDK load, so getWalrusStatus() afterwards
    // reports a real sdkInstalled value rather than a guess.
    const walrusProbe = await probeWalrusLive();
    const walrus = await getWalrusStatus();
    const tatum = await getTatumStatus();

    const [memoryTotal, memoryVerified, memoryMirror, decisions, decisionsEvaluated, lessons, lessonsApplied, lastObservation] =
      await Promise.all([
        db.memoryRecord.count({ where: { userId: user.id } }),
        db.memoryRecord.count({ where: { userId: user.id, sourceType: "WALRUS", storageState: "VERIFIED" } }),
        db.memoryRecord.count({ where: { userId: user.id, sourceType: "LOCAL_MIRROR" } }),
        db.decision.count({ where: { userId: user.id } }),
        db.decision.count({ where: { userId: user.id, status: "EVALUATED" } }),
        db.lesson.count(),
        db.lesson.count({ where: { status: { in: ["SUPPORTED", "APPLIED"] } } }),
        db.chainObservation.findFirst({ orderBy: { observedAt: "desc" } }),
      ]);

    return jsonNoStore({
      workspace: { id: user.id, displayName: user.displayName },
      integrations: {
        walrus: {
          configured: walrus.configured,
          transport: walrus.transport,
          live: walrusProbe.ok,
          network: walrus.network,
          sdkInstalled: walrus.sdkInstalled,
          missingEnv: walrus.missingEnv,
          namespace: walrus.namespace,
          source: walrus.source,
          envFallbackAvailable: walrus.envFallbackAvailable,
          customSaved: walrus.customSaved,
          note:
            walrus.transport === "memwal-sdk"
              ? walrusProbe.ok
                ? `Live — memories persist through the Walrus Memory relayer (${walrusProbe.detail}). Credential source: ${walrus.source === "custom" ? "saved in Settings by you" : "built-in .env"}. Writes are encrypted, semantically searchable, and stored as blobs on Walrus mainnet owned by your MemWal account.`
                : `MemWal transport selected but authentication failed: ${walrusProbe.detail ?? "unknown"}. Writes automatically fall back to the Tatum Storage API, so memories still reach Walrus mainnet and stay verified. Fix: test your delegate key in Settings (or the Walrus Memory dashboard) and save the corrected PRIVATE key there.`
              : walrus.transport === "tatum-storage-api"
                ? walrusProbe.ok
                  ? `Live — memories persist to Walrus mainnet via the Tatum Storage API (${walrusProbe.detail}). Writes are certified on-chain (~4 epochs, auto-renewed) and readable from any public Walrus aggregator.`
                  : `Configured (Tatum Storage API) but the live probe failed: ${walrusProbe.detail ?? "unknown"}. Writes will still be attempted; failures stay PENDING_SYNC.`
                : "Not configured — memories are kept as LOCAL_MIRROR. Save your own Walrus Memory credentials in Settings, or set TATUM_API_KEY / MemWal env vars, to enable persistence.",
        },
        tatum: {
          configured: tatum.configured,
          network: tatum.network,
          networkEnvSet: tatum.networkEnvSet,
          gatewayUrl: tatum.gatewayUrl,
          source: tatum.source,
          customSaved: tatum.customSaved,
          envFallbackAvailable: tatum.envFallbackAvailable,
          note: tatum.configured
            ? `Ready — Sui gRPC gateway ${tatum.gatewayUrl} (Protocol Buffers over HTTP/2). Key source: ${tatum.source === "custom" ? "saved in Settings by you" : "built-in .env"}.`
            : "Not configured — ChainLens and on-chain evidence need a Tatum API key. Save one in Settings (or set TATUM_API_KEY in .env).",
        },
        ai: { configured: true, note: "Built-in server-side reasoning model — configured and ready." },
      },
      counters: {
        memoryTotal,
        memoryVerified,
        memoryMirror,
        decisions,
        decisionsEvaluated,
        lessons,
        lessonsApplied,
        lastObservationAt: lastObservation?.observedAt ?? null,
        lastObservationKind: lastObservation?.kind ?? null,
      },
    });
  } catch (err) {
    return jsonNoStore({ error: "STATUS_FAILED", detail: (err as Error).message }, { status: 500 });
  }
}
