"use client";

/**
 * Injection-fallback Sui wallet detection — Task 23.
 *
 * Modern Sui wallets (Slush, Suiet, Bitget, OKX, Nightly, Martian, …) register
 * through the Sui Wallet Standard, and @mysten/dapp-kit lists them
 * automatically. Some wallet builds — older extension versions, certain mobile
 * in-app browsers — only expose a `window`-injected provider without standard
 * registration, so they would otherwise stay invisible even though they are
 * installed.
 *
 * This module wraps those injected providers in an honest Wallet Standard
 * adapter and registers it with the same registry dapp-kit reads. Detection is
 * strictly capability-checked: a provider is only wrapped when it actually
 * exposes the Sui surface (connect + getAccounts + at least one real Sui sign
 * capability). Nothing is invented, no wallet name is fabricated — the adapter
 * only mirrors what the installed provider can genuinely do.
 *
 * Sign features are REAL passthroughs to the provider. RECALLOS itself never
 * calls them (read-only posture), but exposing them keeps the wallet's
 * capability profile truthful for any standard-conformant consumer.
 */

import { getWallets, registerWallet, type Wallet, type WalletAccount } from "@mysten/wallet-standard";

/* ------------------------------ provider shape ----------------------------- */

type InjectedProvider = {
  connect?: (input?: { silent?: boolean }) => Promise<unknown>;
  getAccounts: () => Promise<unknown>;
  on?: (event: string, listener: (payload: unknown) => void) => void;
  off?: (event: string, listener: (payload: unknown) => void) => void;
  removeListener?: (event: string, listener: (payload: unknown) => void) => void;
  signTransaction?: (input: unknown) => Promise<unknown>;
  signAndExecuteTransaction?: (input: unknown) => Promise<unknown>;
  signTransactionBlock?: (input: unknown) => Promise<unknown>;
  signAndExecuteTransactionBlock?: (input: unknown) => Promise<unknown>;
};

const SIGN_METHODS = [
  "signTransaction",
  "signAndExecuteTransaction",
  "signTransactionBlock",
  "signAndExecuteTransactionBlock",
] as const;

/** Narrow an unknown `window` value into an InjectedProvider — or null. */
function asProvider(value: unknown): InjectedProvider | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  if (typeof p.connect !== "function" || typeof p.getAccounts !== "function") return null;
  const hasSign = SIGN_METHODS.some((m) => typeof p[m] === "function");
  if (!hasSign) return null;
  return p as unknown as InjectedProvider;
}

/* ------------------------------ known providers ---------------------------- */

/** Typed window access — no `any`, only the specific slots we probe. */
function injectedWindow(): {
  bitkeep?: { suiWallet?: unknown };
  okxwallet?: { suiWallet?: unknown };
  suiet?: unknown;
  suiWallet?: unknown;
  nightly?: { suiSui?: unknown };
  martian?: { sui?: unknown };
} {
  return window as unknown as {
    bitkeep?: { suiWallet?: unknown };
    okxwallet?: { suiWallet?: unknown };
    suiet?: unknown;
    suiWallet?: unknown;
    nightly?: { suiSui?: unknown };
    martian?: { sui?: unknown };
  };
}

const KNOWN_INJECTED_PROVIDERS: Array<{ name: string; resolve: () => unknown }> = [
  { name: "Bitget Wallet", resolve: () => injectedWindow().bitkeep?.suiWallet ?? null },
  { name: "OKX Wallet", resolve: () => injectedWindow().okxwallet?.suiWallet ?? null },
  { name: "Suiet", resolve: () => injectedWindow().suiet ?? null },
  { name: "Sui Wallet", resolve: () => injectedWindow().suiWallet ?? null },
  { name: "Nightly", resolve: () => injectedWindow().nightly?.suiSui ?? null },
  { name: "Martian", resolve: () => injectedWindow().martian?.sui ?? null },
];

/* --------------------------------- helpers --------------------------------- */

/** Neutral glyph used for adapters (we never fake a wallet's brand icon). */
const GENERIC_WALLET_ICON =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjOGI4ZmEzIiBzdHJva2Utd2lkdGg9IjEuOCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cmVjdCB4PSIyIiB5PSI1IiB3aWR0aD0iMjAiIGhlaWdodD0iMTUiIHJ4PSIzIi8+PHBhdGggZD0iTTIgMTBoMjAiLz48cGF0aCBkPSJNMTcgMTVoMiIvPjwvc3ZnPg==";

function decodePublicKey(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string" && value.length > 0) {
    const hex = value.startsWith("0x") ? value.slice(2) : value;
    if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < out.length; i += 1) {
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      }
      return out;
    }
  }
  return new Uint8Array();
}

function extractRawAccounts(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    if (Array.isArray(p.accounts)) return p.accounts;
    if (typeof p.address === "string") return [p];
  }
  return [];
}

/* ------------------------------- adapter build ------------------------------ */

function createInjectedWalletAdapter(name: string, provider: InjectedProvider): Wallet {
  const signKeys: string[] = [];
  const signFeatures: Record<string, { version: string; [method: string]: unknown }> = {};
  for (const spec of [
    { key: "sui:signTransaction", version: "2.0.0", method: "signTransaction" },
    { key: "sui:signAndExecuteTransaction", version: "2.0.0", method: "signAndExecuteTransaction" },
    { key: "sui:signTransactionBlock", version: "1.0.0", method: "signTransactionBlock" },
    { key: "sui:signAndExecuteTransactionBlock", version: "1.0.0", method: "signAndExecuteTransactionBlock" },
  ] as const) {
    const impl = provider[spec.method];
    if (typeof impl === "function") {
      signKeys.push(spec.key);
      signFeatures[spec.key] = {
        version: spec.version,
        [spec.method]: (input: unknown) => (impl as (i: unknown) => Promise<unknown>)(input),
      };
    }
  }

  const featureKeys = [
    "standard:connect",
    "standard:disconnect",
    "standard:events",
    ...signKeys,
  ] as WalletAccount["features"];

  let accounts: WalletAccount[] = [];
  const changeListeners = new Set<(properties: { accounts?: readonly WalletAccount[] }) => void>();
  const notifyChange = () => {
    for (const listener of changeListeners) listener({ accounts });
  };

  const mapAccount = (raw: unknown): WalletAccount | null => {
    if (!raw || typeof raw !== "object") return null;
    const address = (raw as Record<string, unknown>).address;
    if (typeof address !== "string" || !address.startsWith("0x")) return null;
    return {
      address,
      publicKey: decodePublicKey((raw as Record<string, unknown>).publicKey),
      chains: ["sui:mainnet"],
      features: featureKeys,
      label: "Sui account",
    };
  };

  const replaceAccounts = (rawList: unknown[]): WalletAccount[] => {
    accounts = rawList.map(mapAccount).filter((a): a is WalletAccount => a !== null);
    notifyChange();
    return accounts;
  };

  // Mirror provider-side account changes into the standard 'change' event.
  try {
    provider.on?.("accountsChanged", (payload: unknown) => {
      replaceAccounts(extractRawAccounts(payload));
    });
  } catch {
    /* provider event wiring is best-effort */
  }

  const features = {
    "standard:connect": {
      version: "1.0.0",
      connect: async (input?: { silent?: boolean }) => {
        try {
          await provider.connect?.({ silent: Boolean(input?.silent) });
        } catch (err) {
          // Silent reconnects may legitimately fail when no prior authorization
          // exists — fall through to getAccounts(). An explicit connect that is
          // declined must surface as a real error.
          if (!input?.silent) throw err;
        }
        const raw = await provider.getAccounts();
        return { accounts: replaceAccounts(extractRawAccounts(raw)) };
      },
    },
    "standard:disconnect": {
      version: "1.0.0",
      disconnect: async () => {
        accounts = [];
        notifyChange();
      },
    },
    "standard:events": {
      version: "1.0.0",
      on: (event: string, listener: (properties: { accounts?: readonly WalletAccount[] }) => void) => {
        if (event !== "change") return () => {};
        changeListeners.add(listener);
        return () => {
          changeListeners.delete(listener);
        };
      },
    },
    ...signFeatures,
  };

  const wallet: Wallet = {
    version: "1.0.0",
    name,
    icon: GENERIC_WALLET_ICON,
    chains: ["sui:mainnet"],
    features: features as unknown as Wallet["features"],
    get accounts() {
      return accounts;
    },
  };
  return wallet;
}

/* --------------------------------- scanning -------------------------------- */

const registeredAdapters = new Map<string, Wallet>();

/**
 * Scan the window for known injected Sui providers that are NOT already visible
 * through the Wallet Standard, and register honest adapters for them. Safe to
 * call repeatedly (idempotent). Returns how many adapters were newly added.
 */
export function scanForInjectedWallets(): number {
  if (typeof window === "undefined") return 0;
  let added = 0;
  const standardNames = new Set(getWallets().get().map((w) => w.name));
  for (const candidate of KNOWN_INJECTED_PROVIDERS) {
    if (registeredAdapters.has(candidate.name) || standardNames.has(candidate.name)) continue;
    let provider: InjectedProvider | null = null;
    try {
      provider = asProvider(candidate.resolve());
    } catch {
      provider = null;
    }
    if (!provider) continue;
    const adapter = createInjectedWalletAdapter(candidate.name, provider);
    try {
      registerWallet(adapter);
      registeredAdapters.set(candidate.name, adapter);
      added += 1;
    } catch {
      /* registry unavailable — skip this provider */
    }
  }
  return added;
}
