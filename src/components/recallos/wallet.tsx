"use client";

/**
 * Sui Wallet connection — Tasks 22 & 23.
 *
 * Design constraints (RECALLOS honesty rules):
 *  - Only REAL installed wallets are offered for connection. Detection has two
 *    layers: (1) the Sui Wallet Standard via @mysten/dapp-kit, and (2) an
 *    injection-fallback scan (src/lib/sui/injected-wallets.ts) that wraps
 *    capability-checked window providers — e.g. Bitget (window.bitkeep.suiWallet)
 *    or OKX (window.okxwallet.suiWallet) — when an installed wallet build did
 *    not register with the standard.
 *  - The "Popular Sui wallets" grid is clearly an install directory, not a list
 *    of connected wallets: every row states whether that wallet is actually
 *    detected in this browser, and links to the wallet's official site.
 *  - The connection is strictly read-only: no transaction is ever signed, no
 *    message is ever signed, no seed phrase is ever requested. The connected
 *    address lives in the browser and reaches the server only when the user
 *    explicitly runs a ChainLens observation with it.
 */

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  SuiClientProvider,
  WalletProvider,
  createNetworkConfig,
  useConnectWallet,
  useCurrentAccount,
  useCurrentWallet,
  useDisconnectWallet,
  useSuiClient,
  useWallets,
} from "@mysten/dapp-kit";
import type { WalletWithRequiredFeatures } from "@mysten/wallet-standard";
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  LogOut,
  RefreshCw,
  ScanSearch,
  Wallet,
  WalletCards,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { scanForInjectedWallets } from "@/lib/sui/injected-wallets";

/* ------------------------------ provider tree ------------------------------ */

const { networkConfig } = createNetworkConfig({
  mainnet: { url: getJsonRpcFullnodeUrl("mainnet"), network: "mainnet" },
});

/**
 * dapp-kit's default filter only accepts `sui:signTransaction` /
 * `sui:signTransactionBlock`. Several real Sui providers (notably older
 * injection-only builds) expose the legacy signAndExecute* APIs instead —
 * accept every real Sui sign capability, still never anything without one.
 */
const SUI_SIGN_FEATURES = [
  "sui:signTransaction",
  "sui:signTransactionBlock",
  "sui:signAndExecuteTransaction",
  "sui:signAndExecuteTransactionBlock",
] as const;

const suiWalletFilter = (wallet: WalletWithRequiredFeatures) =>
  SUI_SIGN_FEATURES.some((feature) => Boolean(wallet.features[feature]));

/**
 * Registers injection-fallback adapters for wallets that never announced
 * themselves via the Wallet Standard. Runs in an effect: React flushes child
 * effects before the parent WalletConnectionManager's effects, so the adapters
 * are in the registry before useWalletsChanged snapshots the list and before
 * autoConnect resolves.
 */
function InjectedWalletBridge() {
  useEffect(() => {
    scanForInjectedWallets();
  }, []);
  return null;
}

export function WalletProviders({ children }: { children: React.ReactNode }) {
  // dapp-kit's WalletProvider is built on react-query — a per-mount client avoids
  // sharing cache state across requests during SSR.
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork="mainnet">
        <WalletProvider autoConnect walletFilter={suiWalletFilter}>
          <InjectedWalletBridge />
          {children}
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}

/* --------------------------------- helpers --------------------------------- */

const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/** Exact MIST → SUI conversion (1 SUI = 10^9 MIST), trailing zeros trimmed. */
function mistToSui(mist: string): string {
  const neg = mist.startsWith("-");
  const digits = (neg ? mist.slice(1) : mist).padStart(10, "0");
  const whole = digits.slice(0, -9).replace(/^0+(?=\d)/, "");
  const frac = digits.slice(-9).replace(/0+$/, "");
  const v = frac ? `${whole}.${frac}` : whole;
  return neg ? `-${v}` : v;
}

/** Install directory — all entries genuinely support Sui. Detection state is
 *  shown per wallet; names must match the wallet's real registry name. */
const WALLET_DIRECTORY = [
  { name: "Bitget Wallet", url: "https://web3.bitget.com", detect: "Bitget Wallet" },
  { name: "Slush — Sui Wallet", url: "https://slush.app", detect: "Slush" },
  { name: "Suiet", url: "https://suiet.app", detect: "Suiet" },
  { name: "OKX Wallet", url: "https://www.okx.com/web3", detect: "OKX Wallet" },
  { name: "Nightly", url: "https://nightly.app", detect: "Nightly" },
  { name: "Martian", url: "https://martianwallet.xyz", detect: "Martian" },
] as const;

/* ------------------------------ connect button ------------------------------ */

export function ConnectWalletButton({ alwaysLabeled = false }: { alwaysLabeled?: boolean }) {
  const account = useCurrentAccount();
  const { currentWallet } = useCurrentWallet();
  const { mutateAsync: connect, isPending: connecting, variables: connectVars } = useConnectWallet();
  const { mutateAsync: disconnect, isPending: disconnecting } = useDisconnectWallet();
  const wallets = useWallets();
  const { toast } = useToast();
  const suiClient = useSuiClient();

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [scanning, setScanning] = useState(false);
  // The user's OWN balance, read straight from the public Sui fullnode in
  // their browser — no RECALLOS/Tatum key or any other person's credentials
  // are involved. Null while loading; "unavailable" on failure (never guessed).
  const [ownBalance, setOwnBalance] = useState<string | null>(null);

  useEffect(() => {
    setOwnBalance(null);
    if (!account) return;
    let cancelled = false;
    suiClient
      .getBalance({ owner: account.address })
      .then((b) => {
        if (!cancelled) setOwnBalance(`${mistToSui(b.totalBalance)} SUI`);
      })
      .catch(() => {
        // balance lookup failed (fullnode hiccup) — honest blank, not a fake 0
      });
    return () => {
      cancelled = true;
    };
  }, [suiClient, account]);

  const copyAddress = () => {
    if (!account) return;
    navigator.clipboard
      ?.writeText(account.address)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => toast({ title: "Copy failed", description: "Clipboard unavailable in this browser." }));
  };

  const pick = async (walletName: string) => {
    const wallet = wallets.find((w) => w.name === walletName);
    if (!wallet) return;
    try {
      await connect({ wallet });
      setOpen(false);
      toast({
        title: `${wallet.name} connected`,
        description: "Read-only connection — RECALLOS never requests signatures.",
      });
    } catch (e) {
      toast({ title: "Connection declined", description: (e as Error).message || "The wallet request was rejected." });
    }
  };

  const rescan = () => {
    setScanning(true);
    // Registration fires a registry event; give dapp-kit's listener a beat, then
    // let the next render pick the wallets up.
    setTimeout(() => {
      scanForInjectedWallets();
      setScanning(false);
    }, 300);
  };

  /* ------------------------------- connected ------------------------------- */
  if (account) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className="inline-flex items-center gap-1.5 rounded-full border border-verified/40 bg-verified/10 px-2.5 py-1 text-xs font-medium text-verified transition-colors hover:bg-verified/15"
            title={`${account.address} — connected via ${currentWallet?.name ?? "Sui wallet"} (read-only)`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-verified" />
            <span className="font-mono">{shortAddr(account.address)}</span>
            <ChevronDown className="h-3 w-3 opacity-70" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your wallet</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Connected via{" "}
            <span className="font-medium text-foreground">{currentWallet?.name ?? "Sui wallet"}</span>
          </p>
          <p className="mt-2 break-all rounded-lg border border-border/60 bg-background/40 p-2.5 font-mono text-[11px] leading-relaxed">
            {account.address}
          </p>
          <div className="mt-3 flex items-center justify-between rounded-lg border border-verified/30 bg-verified/5 px-2.5 py-2">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Your balance</span>
            <span className="text-sm font-semibold tabular-nums text-verified">
              {ownBalance ?? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Read directly from the public Sui network with your own wallet — your keys and credentials never leave your
            device, and no one else's key is ever used.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={copyAddress}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-secondary/50 px-2.5 py-1.5 text-xs transition-colors hover:bg-secondary"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-verified" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy address"}
            </button>
            <button
              onClick={() => disconnect()}
              disabled={disconnecting}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-secondary/50 px-2.5 py-1.5 text-xs text-conflict transition-colors hover:bg-secondary disabled:opacity-50"
            >
              {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
              Disconnect
            </button>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            Read-only connection with your own wallet — RECALLOS never requests signatures or transactions, and ChainLens
            observations use this address only when you ask for it.
          </p>
        </PopoverContent>
      </Popover>
    );
  }

  /* ------------------------------ disconnected ----------------------------- */
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          title="Connect a Sui wallet (read-only)"
        >
          <Wallet className="h-3.5 w-3.5" />
          {/* Header on very narrow phones drops the label to save space; the
              drawer passes alwaysLabeled so it always reads as a full pill. */}
          <span className={alwaysLabeled ? "inline" : "hidden min-[400px]:inline"}>Connect wallet</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Connect a Sui wallet</p>

        {wallets.length > 0 ? (
          <div className="mt-2 grid gap-1.5" data-testid="detected-wallets">
            {wallets.map((w) => (
              <button
                key={w.name}
                onClick={() => pick(w.name)}
                disabled={connecting}
                className="flex min-h-11 items-center gap-2.5 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-sm transition-colors hover:bg-secondary/60 disabled:opacity-60"
              >
                {w.icon ? (
                  <img src={w.icon} alt="" className="h-5 w-5 rounded" />
                ) : (
                  <WalletCards className="h-5 w-5 text-muted-foreground" />
                )}
                <span className="font-medium">{w.name}</span>
                {connecting && connectVars?.wallet?.name === w.name ? (
                  <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-verified">
                    <Check className="h-3 w-3" /> Detected
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-2 rounded-lg border border-border/60 bg-background/40 p-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              No Sui wallet detected in this browser yet. Install one below, then click “Re-scan” (or reload this
              page).
            </p>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Popular Sui wallets
          </p>
          <button
            onClick={rescan}
            disabled={scanning}
            className="inline-flex min-h-7 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
            title="Look again for installed Sui wallets (including injected providers like Bitget)"
          >
            {scanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanSearch className="h-3 w-3" />}
            Re-scan
          </button>
        </div>
        <div className="mt-1.5 grid gap-1">
          {WALLET_DIRECTORY.map((l) => {
            const detected = wallets.some((w) => w.name === l.detect);
            return (
              <a
                key={l.name}
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className="group flex min-h-9 items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-secondary/60"
              >
                {detected ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-verified" />
                ) : (
                  <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="font-medium text-foreground">{l.name}</span>
                <span className="ml-auto inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {detected ? (
                    "Detected"
                  ) : (
                    <>
                      Get <ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                    </>
                  )}
                </span>
              </a>
            );
          })}
        </div>

        <p className={cn("mt-3 text-[11px] leading-relaxed text-muted-foreground")}>
          Connecting is read-only: RECALLOS never asks you to sign anything.
        </p>
      </PopoverContent>
    </Popover>
  );
}
