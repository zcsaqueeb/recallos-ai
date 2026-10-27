"use client";

/**
 * ChainLens observation renderers — Task 24.
 *
 * LIVE observations are real on-chain data, so the presentation treats them
 * like a well-designed wallet/block explorer would: formatted amounts, human
 * labels, copyable identifiers, honest empty states. The raw JSON returned by
 * the gateway is never thrown away — it moves into a collapsed "Raw response"
 * section so provenance stays auditable (RECALLOS honesty rules) while the
 * main surface stays readable.
 *
 * Formatting policy (strictly factual):
 *  - SUI amounts are converted from MIST (1 SUI = 10^9 MIST) — protocol-fixed
 *    decimals, always exact, never rounded behind the user's back (the exact
 *    MIST value is printed next to the formatted one).
 *  - Other tokens are shown in their raw base units exactly as returned by
 *    the chain, because token decimals vary per coin and the gRPC balance
 *    response does not carry a decimals field — inventing one would be lying.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  Check,
  ChevronDown,
  CircleDashed,
  Coins,
  Copy,
  Layers,
  Link2,
  Stamp,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const SUI_TYPE = "0x2::sui::SUI";

/* --------------------------------- parsing --------------------------------- */

type BalanceRow = { coinType: string; totalBalance: string };
type ObjectRow = {
  objectAddress: string;
  version: string;
  digest: string | null;
  hasPublicTransfer: boolean | null;
  type: string | null;
};
type BalanceChange = { amount: string; coinType: string; owner: string | null };

type Parsed = {
  address: string | null;
  suiTotalBalance: string | null;
  balances: BalanceRow[];
  objects: ObjectRow[];
  hasMore: boolean | null;
  chain: string | null;
  chainId: string | null;
  epoch: string | null;
  latestCheckpoint: { sequenceNumber: string | null; digest: string | null; timestamp: string | null } | null;
  digest: string | null;
  sender: string | null;
  status: string | null;
  timestamp: string | null;
  balanceChanges: BalanceChange[];
};

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

function rows<T>(v: unknown, map: (item: unknown) => T | null): T[] {
  return Array.isArray(v) ? v.map(map).filter((x): x is T => x !== null) : [];
}

const asBalanceRow = (v: unknown): BalanceRow | null => {
  if (!v || typeof v !== "object") return null;
  const coinType = str((v as Record<string, unknown>).coinType);
  const totalBalance = str((v as Record<string, unknown>).totalBalance) ?? str((v as Record<string, unknown>).balance);
  return coinType && totalBalance ? { coinType, totalBalance } : null;
};

const asObjectRow = (v: unknown): ObjectRow | null => {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const objectAddress = str(r.objectAddress) ?? str(r.objectId);
  if (!objectAddress) return null;
  return {
    objectAddress,
    version: str(r.version) ?? "—",
    digest: str(r.digest),
    hasPublicTransfer: bool(r.hasPublicTransfer),
    type: str(r.type),
  };
};

const asBalanceChange = (v: unknown): BalanceChange | null => {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const amount = str(r.amount);
  const coinType = str(r.coinType);
  if (amount === null || !coinType) return null;
  return { amount, coinType, owner: str(r.owner) ?? str(r.address) };
};

function parseResult(result: Record<string, unknown>): Parsed {
  const cp = result.latestCheckpoint;
  return {
    address: str(result.address),
    suiTotalBalance: str(result.suiTotalBalance),
    balances: rows(result.balances, asBalanceRow),
    objects: rows(result.objects, asObjectRow),
    hasMore: bool(result.hasMore),
    chain: str(result.chain),
    chainId: str(result.chainId),
    epoch: str(result.epoch),
    latestCheckpoint:
      cp && typeof cp === "object"
        ? {
            sequenceNumber: str((cp as Record<string, unknown>).sequenceNumber),
            digest: str((cp as Record<string, unknown>).digest),
            timestamp: str((cp as Record<string, unknown>).timestamp),
          }
        : null,
    digest: str(result.digest),
    sender: str(result.sender),
    status: str(result.status),
    timestamp: str(result.timestamp),
    balanceChanges: rows(result.balanceChanges, asBalanceChange),
  };
}

/* -------------------------------- formatting ------------------------------- */

/** Thousands-separator grouping for a plain integer string (sign preserved). */
function groupInteger(raw: string): string {
  const m = /^(-?)(\d+)$/.exec(raw.trim());
  if (!m) return raw;
  return m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** MIST (10^-9) → exact SUI decimal string. Falls back to the raw value when
 *  the input is not a plain integer (defensive — never fabricates a number). */
function mistToSui(mist: string): string {
  const m = /^(-?)(\d+)$/.exec(mist.trim());
  if (!m) return mist;
  const neg = m[1] === "-";
  const padded = m[2].padStart(10, "0");
  const intPart = padded.slice(0, padded.length - 9);
  const fracPart = padded.slice(padded.length - 9).replace(/0+$/, "");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = fracPart ? `${grouped}.${fracPart}` : grouped;
  return neg && m[2] !== "0" ? `-${body}` : body;
}

/** Symbol chip for a coin type: the last :: segment, falling back to the
 *  module name when the package uses a generic "COIN"/"TOKEN" name. */
function coinSymbol(coinType: string): string {
  const segs = coinType.split("::");
  const last = segs[segs.length - 1] ?? coinType;
  if (!/^(COIN|TOKEN|COINTYPE)$/i.test(last)) return last;
  return (segs[segs.length - 2] ?? last).toUpperCase();
}

function shortenType(coinType: string): string {
  if (coinType.length <= 30) return coinType;
  return `${coinType.slice(0, 14)}…${coinType.slice(-10)}`;
}

function shortHex(v: string): string {
  return v.length > 18 ? `${v.slice(0, 10)}…${v.slice(-6)}` : v;
}

export function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  if (diff < 45_000) return "just now";
  if (diff < 90_000) return "1 min ago";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} h ago`;
  return `${Math.round(diff / 86_400_000)} d ago`;
}

export function absoluteTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString();
}

/* ------------------------------- tiny widgets ------------------------------ */

function CopyChip({ value, label, className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard
          ?.writeText(value)
          .then(() => setCopied(true))
          .catch(() => {})
      }
      title={label ?? `Copy ${value}`}
      className={cn(
        "inline-flex min-h-6 items-center gap-1 rounded-md border border-border/50 bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
        copied && "border-verified/40 text-verified",
        className,
      )}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : (label ?? "Copy")}
    </button>
  );
}

function MetaChip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      {icon} {children}
    </span>
  );
}

/** Raw gateway JSON — collapsed by default, always available for audit. */
function RawResponse({ result }: { result: Record<string, unknown> }) {
  return (
    <details className="group mt-4 rounded-lg border border-border/50 bg-background/30">
      <summary className="flex cursor-pointer select-none items-center gap-1.5 px-3 py-2 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
        Raw response — exact gateway JSON, for audit
      </summary>
      <pre className="max-h-72 overflow-auto scrollbar-thin border-t border-border/40 px-3 py-2.5 font-mono text-[11px] leading-relaxed">
        {JSON.stringify(result, null, 2)}
      </pre>
    </details>
  );
}

/** Empty-value panel used when the chain truthfully reports "nothing here". */
function OnchainEmpty({ title, hint, icon }: { title: string; hint: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border/70 bg-background/20 px-5 py-6 text-center">
      <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-muted/40 text-muted-foreground">
        {icon}
      </div>
      <p className="mt-2.5 text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">{hint}</p>
    </div>
  );
}

/* ------------------------------ BALANCE result ----------------------------- */

function BalanceView({ p, network }: { p: Parsed; network: string }) {
  const otherTokens = p.balances.filter((b) => b.coinType !== SUI_TYPE);
  const suiRaw = p.suiTotalBalance ?? p.balances.find((b) => b.coinType === SUI_TYPE)?.totalBalance ?? null;
  const suiFormatted = suiRaw !== null ? mistToSui(suiRaw) : null;
  const zero = suiRaw === "0" && otherTokens.length === 0;

  return (
    <div className="space-y-4">
      {/* hero — total SUI */}
      <div className="rounded-xl border border-border/60 bg-background/40 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Coins className="h-3.5 w-3.5" /> Total SUI balance
            </p>
            <p className="mt-1.5 font-mono text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">
              {suiFormatted ?? "—"} <span className="text-lg font-medium text-muted-foreground sm:text-xl">SUI</span>
            </p>
            {suiRaw !== null && suiRaw !== "0" ? (
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                exact: {groupInteger(suiRaw)} MIST (1 SUI = 10<sup>9</sup> MIST)
              </p>
            ) : null}
          </div>
          {p.address ? (
            <div className="flex flex-col items-end gap-1.5">
              <span className="font-mono text-[11px] text-muted-foreground">{shortHex(p.address)}</span>
              <CopyChip value={p.address} label="Copy address" />
            </div>
          ) : null}
        </div>
      </div>

      {zero ? (
        <OnchainEmpty
          icon={<Wallet className="h-4 w-4" />}
          title="This address holds no SUI or other tokens"
          hint={`The chain reports an empty balance for it on ${network} right now. Newly created wallets start empty — once the address receives funds, the next observation will show them here.`}
        />
      ) : (
        <>
          {otherTokens.length > 0 ? (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Other token balances
              </p>
              <div className="overflow-hidden rounded-xl border border-border/60">
                {otherTokens.map((b, i) => (
                  <div
                    key={b.coinType}
                    className={cn(
                      "flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5",
                      i > 0 && "border-t border-border/50",
                      i % 2 === 1 && "bg-background/40",
                    )}
                  >
                    <span className="inline-flex min-w-16 items-center rounded-md bg-insight/10 px-2 py-0.5 text-[11px] font-semibold text-insight">
                      {coinSymbol(b.coinType)}
                    </span>
                    <span className="font-mono text-sm tabular-nums">{groupInteger(b.totalBalance)}</span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">base units</span>
                    <span className="ml-auto hidden font-mono text-[10px] text-muted-foreground sm:block">
                      {shortenType(b.coinType)}
                    </span>
                    <CopyChip value={b.coinType} label="Type" />
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                SUI is converted from MIST (protocol-fixed 9 decimals). Other tokens are shown in their raw base units
                exactly as the chain returns them — coin decimals vary and are not reported by the balance call.
              </p>
            </div>
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">
              No other token balances on this address — SUI is the only asset the chain reports here.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------------------- OWNED OBJECTS view --------------------------- */

function OwnedObjectsView({ p, network }: { p: Parsed; network: string }) {
  if (p.objects.length === 0) {
    return (
      <OnchainEmpty
        icon={<Boxes className="h-4 w-4" />}
        title="This address owns no on-chain objects"
        hint={`The chain reports zero owned objects on ${network} right now. NFTs, tokens objects and other assets owned by this address would appear here after they are acquired.`}
      />
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <MetaChip icon={<Boxes className="h-3 w-3" />}>
          {p.objects.length} object{p.objects.length === 1 ? "" : "s"} (first page)
        </MetaChip>
        {p.hasMore === true ? <MetaChip icon={<Layers className="h-3 w-3" />}>more pages available</MetaChip> : null}
        {p.address ? <CopyChip value={p.address} label="Copy owner" className="rounded-full" /> : null}
      </div>
      <div className="overflow-hidden rounded-xl border border-border/60">
        {p.objects.map((o, i) => (
          <div
            key={o.objectAddress}
            className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2.5", i > 0 && "border-t border-border/50", i % 2 === 1 && "bg-background/40")}
          >
            {o.type ? (
              <span className="inline-flex items-center rounded-md bg-memory/10 px-2 py-0.5 font-mono text-[10px] text-memory">
                {shortenType(o.type)}
              </span>
            ) : (
              <span className="inline-flex items-center rounded-md bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground">
                type not read
              </span>
            )}
            <span className="font-mono text-xs">{shortHex(o.objectAddress)}</span>
            <span className="text-[10px] text-muted-foreground">v{o.version}</span>
            {o.hasPublicTransfer === true ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-verified/30 bg-verified/10 px-1.5 py-0.5 text-[10px] font-medium text-verified">
                public transfer
              </span>
            ) : null}
            <span className="ml-auto flex items-center gap-1.5">
              <CopyChip value={o.objectAddress} label="ID" />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------- CHECKPOINT view ----------------------------- */

function MetricTile({ icon, label, value, mono }: { icon: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/40 p-3.5">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon} {label}
      </p>
      <p className={cn("mt-1.5 text-lg font-semibold tabular-nums", mono && "font-mono text-sm break-all")}>{value}</p>
    </div>
  );
}

function CheckpointView({ p, network }: { p: Parsed; network: string }) {
  const cp = p.latestCheckpoint;
  const ts = cp?.timestamp;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricTile icon={<Link2 className="h-3 w-3" />} label="Chain" value={p.chain ?? network} />
        <MetricTile icon={<CircleDashed className="h-3 w-3" />} label="Epoch" value={p.epoch ?? "—"} />
        <MetricTile
          icon={<Stamp className="h-3 w-3" />}
          label="Checkpoint"
          value={cp?.sequenceNumber ? groupInteger(cp.sequenceNumber) : "—"}
        />
        <MetricTile icon={<Layers className="h-3 w-3" />} label="Observed at" value={ts ? relativeTime(ts) : "—"} />
      </div>
      {ts ? (
        <p className="text-xs text-muted-foreground">
          Checkpoint timestamp: <span className="text-foreground">{absoluteTime(ts)}</span>
          <span className="text-muted-foreground"> ({relativeTime(ts)})</span>
        </p>
      ) : null}
      <div className="space-y-1.5 rounded-xl border border-border/60 bg-background/40 p-3.5">
        {cp?.digest ? (
          <p className="break-all font-mono text-[11px] leading-relaxed">
            <span className="text-muted-foreground">digest </span>
            {cp.digest}
            <CopyChip value={cp.digest} label="Copy digest" className="ml-2" />
          </p>
        ) : null}
        {p.chainId ? (
          <p className="break-all font-mono text-[11px] leading-relaxed">
            <span className="text-muted-foreground">chainId </span>
            {p.chainId}
            <CopyChip value={p.chainId} label="Copy chainId" className="ml-2" />
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* ----------------------------- TRANSACTION view ---------------------------- */

function BalanceChangesList({ changes }: { changes: BalanceChange[] }) {
  if (changes.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border/70 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        The gateway returned no balance changes for this transaction (typical for pure governance or read-style calls).
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border/60">
      {changes.map((c, i) => {
        const isSui = c.coinType === SUI_TYPE;
        const m = /^([+-]?)(\d+)$/.exec(c.amount.trim());
        const sign = m && m[1] === "-" ? "-" : "+";
        const magnitude = m ? m[2] : c.amount.trim();
        const display = isSui && m ? `${sign}${mistToSui(magnitude)}` : m ? `${sign}${groupInteger(magnitude)}` : c.amount;
        const negative = sign === "-";
        return (
          <div
            key={`${c.coinType}-${i}`}
            className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5", i > 0 && "border-t border-border/50", i % 2 === 1 && "bg-background/40")}
          >
            {negative ? (
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-conflict" />
            ) : (
              <ArrowDownRight className="h-3.5 w-3.5 shrink-0 text-verified" />
            )}
            <span className={cn("font-mono text-sm tabular-nums", negative ? "text-conflict" : "text-verified")}>
              {display}
            </span>
            <span className="text-[11px] font-medium">{isSui ? "SUI" : coinSymbol(c.coinType)}</span>
            <span className="ml-auto hidden font-mono text-[10px] text-muted-foreground sm:block">
              {shortenType(c.coinType)}
            </span>
            <CopyChip value={c.coinType} label="Type" />
          </div>
        );
      })}
      <p className="border-t border-border/50 px-3.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
        SUI amounts are converted from MIST; other tokens are raw base units. Arrows mark the direction implied by the
        sign of the amount as returned by the gateway.
      </p>
    </div>
  );
}

function TransactionView({ p }: { p: Parsed }) {
  const failed = (p.status ?? "").toUpperCase() === "FAILURE";
  const ts = p.timestamp;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {p.status ? (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
              failed
                ? "border-conflict/40 bg-conflict/10 text-conflict"
                : "border-verified/40 bg-verified/10 text-verified",
            )}
          >
            {failed ? <CircleDashed className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
            {p.status.toUpperCase()}
          </span>
        ) : null}
        {ts ? <MetaChip icon={<Stamp className="h-3 w-3" />}>{absoluteTime(ts)}</MetaChip> : null}
        {ts ? <MetaChip icon={<Layers className="h-3 w-3" />}>{relativeTime(ts)}</MetaChip> : null}
      </div>
      <div className="space-y-1.5 rounded-xl border border-border/60 bg-background/40 p-3.5">
        {p.digest ? (
          <p className="break-all font-mono text-[11px] leading-relaxed">
            <span className="text-muted-foreground">digest </span>
            {p.digest}
            <CopyChip value={p.digest} label="Copy digest" className="ml-2" />
          </p>
        ) : null}
        {p.sender ? (
          <p className="break-all font-mono text-[11px] leading-relaxed">
            <span className="text-muted-foreground">sender </span>
            {p.sender}
            <CopyChip value={p.sender} label="Copy sender" className="ml-2" />
          </p>
        ) : null}
      </div>
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Balance changes</p>
        <BalanceChangesList changes={p.balanceChanges} />
      </div>
    </div>
  );
}

/* ------------------------------ kind naming -------------------------------- */

export const KIND_LABELS: Record<string, string> = {
  CHECKPOINT: "Latest checkpoint",
  TRANSACTION: "Transaction",
  BALANCE: "Address balance",
  OWNED_OBJECTS: "Owned objects",
};

export const KIND_ICONS: Record<string, React.ReactNode> = {
  CHECKPOINT: <Stamp className="h-4 w-4" />,
  TRANSACTION: <Link2 className="h-4 w-4" />,
  BALANCE: <Coins className="h-4 w-4" />,
  OWNED_OBJECTS: <Boxes className="h-4 w-4" />,
};

/* ----------------------------- kind summary -------------------------------- */

/** One-line factual summary of an observation result for compact surfaces
 *  (dashboard tiles). Strictly derived from the stored gateway payload —
 *  nothing is invented, missing fields simply don't render. */
export function observationSummary(kind: string, result: Record<string, unknown>): string {
  const p = parseResult(result);
  if (kind === "BALANCE") {
    if (p.suiTotalBalance !== null) {
      const extras = p.balances.length;
      const suffix = extras > 0 ? ` + ${extras} other token${extras === 1 ? "" : "s"}` : "";
      return `${mistToSui(p.suiTotalBalance)} SUI${suffix}`;
    }
    return "Balance snapshot";
  }
  if (kind === "CHECKPOINT") {
    const parts: string[] = [];
    if (p.epoch !== null) parts.push(`epoch ${p.epoch}`);
    if (p.latestCheckpoint?.sequenceNumber) parts.push(`checkpoint ${groupInteger(p.latestCheckpoint.sequenceNumber)}`);
    return parts.length > 0 ? parts.join(" · ") : "Chain head";
  }
  if (kind === "OWNED_OBJECTS") {
    const n = p.objects.length;
    if (n === 0) return "No owned objects";
    return `${groupInteger(String(n))}${p.hasMore ? "+" : ""} object${n === 1 ? "" : "s"} on-chain`;
  }
  if (kind === "TRANSACTION") {
    const status = p.status ? p.status.toLowerCase() : null;
    const digest = p.digest ? ` · ${shortHex(p.digest)}` : "";
    return `${status ?? "transaction"}${digest}`;
  }
  return "On-chain observation";
}

/** Ultra-compact value for tight tiles: the single most important token of the
 *  observation, nothing else. The full factual summary stays available via
 *  observationSummary() for hover tooltips. */
export function observationShortValue(kind: string, result: Record<string, unknown>): string {
  const p = parseResult(result);
  if (kind === "BALANCE") return p.suiTotalBalance !== null ? `${mistToSui(p.suiTotalBalance)} SUI` : "SUI";
  if (kind === "CHECKPOINT") return p.latestCheckpoint?.sequenceNumber ? groupInteger(p.latestCheckpoint.sequenceNumber) : "Sui";
  if (kind === "OWNED_OBJECTS") return p.objects.length > 0 ? `${groupInteger(String(p.objects.length))}${p.hasMore ? "+" : ""}` : "0";
  if (kind === "TRANSACTION") return p.status ? p.status.toLowerCase() : "tx";
  return "on-chain";
}

/* ------------------------------- dispatcher -------------------------------- */

export function ObservationBody({
  kind,
  result,
  network,
}: {
  kind: string;
  result: Record<string, unknown>;
  network: string;
}) {
  const p = useMemo(() => parseResult(result), [result]);
  if (kind === "BALANCE") return <BalanceView p={p} network={network} />;
  if (kind === "OWNED_OBJECTS") return <OwnedObjectsView p={p} network={network} />;
  if (kind === "CHECKPOINT") return <CheckpointView p={p} network={network} />;
  if (kind === "TRANSACTION") return <TransactionView p={p} />;
  return <RawResponse result={result} />;
}

export { RawResponse, mistToSui, groupInteger, coinSymbol, shortHex, shortenType };
