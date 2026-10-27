/**
 * Walrus Memory credential normalization + masking.
 * Shared by the Settings API (save/view) and the Settings test endpoint.
 */

export type NormalizedCredentials = {
  delegateKey: string;
  accountId: string;
  serverUrl: string;
  namespace: string | null;
  label: string | null;
};

/** Validate + normalize a credential payload. Returns an error string or the normalized set. */
export function normalizeCredentials(body: Record<string, unknown>): { ok: true; value: NormalizedCredentials } | { ok: false; error: string } {
  const delegateKey = String(body.delegateKey ?? "").trim().replace(/^0x/i, "");
  const accountId = String(body.accountId ?? "").trim();
  const serverUrl = String(body.serverUrl ?? "").trim();
  const namespace = String(body.namespace ?? "").trim();
  const label = String(body.label ?? "").trim();

  if (!/^[0-9a-fA-F]{64}$/.test(delegateKey)) {
    return { ok: false, error: "Delegate key must be a 64-character hex private key (Ed25519) — copy the PRIVATE key from the Walrus Memory dashboard, not the public one." };
  }
  const accountIdNorm = accountId.startsWith("0x") ? accountId : `0x${accountId}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(accountIdNorm)) {
    return { ok: false, error: "Account ID must be a 0x-prefixed 64-character hex object id (the MemWalAccount object on Sui)." };
  }
  if (!/^https?:\/\/.+/i.test(serverUrl)) {
    return { ok: false, error: "Server URL must start with http:// or https:// (official mainnet relayer: https://relayer.memory.walrus.xyz)." };
  }
  if (namespace && !/^[A-Za-z0-9_-]{1,64}$/.test(namespace)) {
    return { ok: false, error: "Namespace may only contain letters, digits, dashes and underscores (max 64 chars)." };
  }
  return {
    ok: true,
    value: {
      delegateKey: delegateKey.toLowerCase(),
      accountId: accountIdNorm.toLowerCase(),
      serverUrl: serverUrl.replace(/\/+$/, ""),
      namespace: namespace || null,
      label: label || null,
    },
  };
}

/** `7b0461…83f965` — enough to recognize a key, never enough to use it. */
export function maskKey(key: string): string {
  const k = key.trim();
  return k.length > 10 ? `${k.slice(0, 4)}…${k.slice(-4)}` : "••••";
}

/** `0x9451b0…aae3` — account ids are public on-chain object ids, masked for tidiness. */
export function maskAccountId(id: string): string {
  const v = id.trim();
  return v.length > 14 ? `${v.slice(0, 6)}…${v.slice(-4)}` : v;
}

/* ------------------------------- Tatum API key ------------------------------ */

export type NormalizedTatumKey = {
  apiKey: string;
  label: string | null;
};

/**
 * Validate + normalize a Tatum API key payload (Settings → "Tatum — Sui gateway").
 * Keys are opaque tokens (official ones look like `t-…`); we only enforce that they
 * are long enough to be real and contain no whitespace (they travel in a header).
 */
export function normalizeTatumKey(body: Record<string, unknown>): { ok: true; value: NormalizedTatumKey } | { ok: false; error: string } {
  const apiKey = String(body.apiKey ?? "").trim();
  const label = String(body.label ?? "").trim();

  if (!apiKey) {
    return { ok: false, error: "API key is required — paste your Tatum API key (portal.tatum.io → API keys)." };
  }
  if (/\s/.test(apiKey)) {
    return { ok: false, error: "API key must not contain whitespace — copy it in one piece from the Tatum portal." };
  }
  if (apiKey.length < 16 || apiKey.length > 200) {
    return { ok: false, error: "API key looks too short or too long — a Tatum key is a single opaque token (official keys start with \"t-\")." };
  }
  if (label.length > 64) {
    return { ok: false, error: "Label is optional and must be at most 64 characters." };
  }
  return { ok: true, value: { apiKey, label: label || null } };
}
