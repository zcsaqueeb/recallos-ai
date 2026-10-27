import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getWalrusConfigResolved,
  getWalrusNamespace,
  resetWalrusRuntime,
} from "@/lib/memory/walrus-client";
import { maskAccountId, maskKey, normalizeCredentials, normalizeTatumKey } from "@/lib/memory/credentials";
import { getTatumConfigResolved } from "@/lib/tatum/config";
import { jsonNoStore } from "@/lib/http";

export const dynamic = "force-dynamic";

/* --------------------------------- helpers --------------------------------- */

/** Shared GET shape — used by GET and returned after PUT/DELETE so the UI updates in one round trip. */
async function settingsView(reveal: boolean) {
  const [active, tatumActive, row] = await Promise.all([
    getWalrusConfigResolved(),
    getTatumConfigResolved(),
    db.appSettings.findUnique({ where: { id: "singleton" } }),
  ]);

  const envDelegateKey = process.env.WALRUS_MEMORY_DELEGATE_KEY || process.env.MEMWAL_PRIVATE_KEY || null;
  const envAccountId = process.env.WALRUS_MEMORY_ACCOUNT_ID || process.env.MEMWAL_ACCOUNT_ID || null;
  const envServerUrl = process.env.WALRUS_MEMORY_SERVER_URL || process.env.MEMWAL_SERVER_URL || null;
  const envTatumKey = process.env.TATUM_API_KEY || null;
  // "present" must mean a COMPLETE MemWal set — the row can legitimately exist while
  // holding only a saved Tatum key (the two credential sets are independent).
  const walrusSaved = Boolean(row?.delegateKey && row?.accountId && row?.serverUrl);

  return {
    active: active
      ? {
          source: active.source,
          transport: active.transport,
          serverUrl: active.serverUrl ?? null,
          namespace: active.namespace,
        }
      : { source: null, transport: null, serverUrl: null, namespace: null },
    custom: walrusSaved
      ? {
          present: true,
          // The delegate key is the only secret: masked by default, revealed only on explicit request.
          delegateKeyMasked: maskKey(row!.delegateKey ?? ""),
          delegateKey: reveal ? row!.delegateKey ?? null : null,
          accountId: row!.accountId ?? null,
          accountIdMasked: row!.accountId ? maskAccountId(row!.accountId) : null,
          serverUrl: row!.serverUrl ?? null,
          namespace: row!.namespace ?? null,
          label: row!.label ?? null,
          updatedAt: row!.updatedAt?.toISOString() ?? null,
        }
      : { present: false },
    // Tatum — Sui gateway: same priority model (saved in Settings → built-in .env).
    tatum: {
      activeSource: tatumActive?.source ?? null,
      gatewayUrl: tatumActive?.gatewayUrl ?? null,
      custom: row?.tatumApiKey
        ? {
            present: true,
            keyMasked: maskKey(row.tatumApiKey),
            key: reveal ? row.tatumApiKey : null,
            label: row.tatumLabel ?? null,
            updatedAt: row.updatedAt?.toISOString() ?? null,
          }
        : { present: false },
      env: { present: Boolean(envTatumKey), keyMasked: envTatumKey ? maskKey(envTatumKey) : null },
    },
    env: {
      memwalPresent: Boolean(envDelegateKey && envAccountId && envServerUrl),
      delegateKeyMasked: envDelegateKey ? maskKey(envDelegateKey) : null,
      accountIdMasked: envAccountId ? maskAccountId(envAccountId) : null,
      serverUrl: envServerUrl,
      tatumPresent: Boolean(envTatumKey),
      namespace: getWalrusNamespace(),
    },
  };
}

/* ----------------------------------- GET ----------------------------------- */

export async function GET(req: NextRequest) {
  try {
    const reveal = req.nextUrl.searchParams.get("reveal") === "1";
    return jsonNoStore(await settingsView(reveal));
  } catch (err) {
    return jsonNoStore({ error: "SETTINGS_READ_FAILED", detail: (err as Error).message }, { status: 500 });
  }
}

/* ----------------------------------- PUT ----------------------------------- */

export async function PUT(req: NextRequest) {
  try {
    let body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    /* ---- Tatum — Sui gateway key (kind: "tatum") — independent of the MemWal set ---- */
    if (body.kind === "tatum") {
      // Friendly re-save: an empty key with keepExistingTatumKey means "keep the stored key".
      if (body.keepExistingTatumKey === true && !String(body.apiKey ?? "").trim()) {
        const row = await db.appSettings.findUnique({ where: { id: "singleton" } });
        if (!row?.tatumApiKey) {
          return NextResponse.json({ error: "INVALID_CREDENTIALS", detail: "No Tatum API key saved yet — paste the key to save." }, { status: 400 });
        }
        body = { ...body, apiKey: row.tatumApiKey };
      }
      const norm = normalizeTatumKey(body);
      if (!norm.ok) {
        return NextResponse.json({ error: "INVALID_CREDENTIALS", detail: norm.error }, { status: 400 });
      }
      await db.appSettings.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", tatumApiKey: norm.value.apiKey, tatumLabel: norm.value.label },
        update: { tatumApiKey: norm.value.apiKey, tatumLabel: norm.value.label },
      });
      // The Walrus probe cache may reflect the old transport state — clear it so the
      // next status call re-probes with the fresh key.
      resetWalrusRuntime();
      return NextResponse.json({ saved: true, ...(await settingsView(false)) });
    }

    /* ---- Walrus Memory set (default, unchanged shape) ---- */
    // Friendly re-save: when a key is already saved and the user only edits the
    // account/URL/namespace, an empty key means "keep the stored key".
    if (body.keepExistingKey === true && !String(body.delegateKey ?? "").trim()) {
      const row = await db.appSettings.findUnique({ where: { id: "singleton" } });
      if (!row?.delegateKey) {
        return NextResponse.json({ error: "INVALID_CREDENTIALS", detail: "No delegate key saved yet — paste the private key to save." }, { status: 400 });
      }
      body = { ...body, delegateKey: row.delegateKey };
    }
    const norm = normalizeCredentials(body);
    if (!norm.ok) {
      return NextResponse.json({ error: "INVALID_CREDENTIALS", detail: norm.error }, { status: 400 });
    }
    // Only touch the MemWal fields — a saved Tatum key must survive Walrus re-saves.
    await db.appSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...norm.value },
      update: { ...norm.value },
    });
    // Force the next operation to rebuild the MemWal client from the new credentials.
    resetWalrusRuntime();
    return NextResponse.json({
      saved: true,
      ...(await settingsView(false)),
    });
  } catch (err) {
    return NextResponse.json({ error: "SETTINGS_SAVE_FAILED", detail: (err as Error).message }, { status: 500 });
  }
}

/* ---------------------------------- DELETE ---------------------------------- */

/**
 * Remove UI-saved credentials — the runtime reverts to the built-in .env set.
 * Scope: "walrus" (default) clears only the MemWal set, "tatum" only the Tatum key,
 * "all" wipes the entire row.
 */
export async function DELETE(req: NextRequest) {
  try {
    const scope = req.nextUrl.searchParams.get("scope") ?? "walrus";
    if (scope === "tatum") {
      await db.appSettings.updateMany({ where: { id: "singleton" }, data: { tatumApiKey: null, tatumLabel: null } });
      resetWalrusRuntime();
    } else if (scope === "all") {
      await db.appSettings.deleteMany({ where: { id: "singleton" } });
      resetWalrusRuntime();
    } else {
      // Walrus-only revert: null out the MemWal fields, keep any saved Tatum key.
      await db.appSettings.updateMany({
        where: { id: "singleton" },
        data: { delegateKey: null, accountId: null, serverUrl: null, namespace: null, label: null },
      });
      resetWalrusRuntime();
    }
    return NextResponse.json({
      saved: false,
      revertedToEnv: true,
      scope,
      ...(await settingsView(false)),
    });
  } catch (err) {
    return NextResponse.json({ error: "SETTINGS_CLEAR_FAILED", detail: (err as Error).message }, { status: 500 });
  }
}
