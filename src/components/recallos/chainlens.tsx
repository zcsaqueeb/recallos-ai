"use client";

import { useCallback, useEffect, useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { StatusPayload } from "./nav";
import { apiFetch, ApiError } from "@/lib/api-client";
import { EmptyBlock, ErrorBlock, LoadingBlock, SectionHeader } from "./shared";
import { Eye, Info, Loader2, Settings2, Telescope, Wallet } from "lucide-react";
import { KIND_ICONS, KIND_LABELS, ObservationBody, RawResponse, relativeTime } from "./observe-result";

type Observation = {
  id: string;
  kind: string;
  method: string;
  paramsJson: string;
  resultJson: string;
  network: string;
  sourceRef: string;
  latencyMs: number | null;
  observedAt: string;
};

type QueryResponse =
  | { mode: "LIVE"; observation: { kind: string; method: string; params: Record<string, unknown>; network: string; sourceRef: string; latencyMs: number; observedAt: string; result: Record<string, unknown> }; interpretationNote: string }
  | { mode: "ERROR"; error: string; detail?: string };

export function ChainLens({ status, onGoSettings }: { status: StatusPayload; onGoSettings: () => void }) {
  const [kind, setKind] = useState("CHECKPOINT");
  const [ref, setRef] = useState("");
  const [address, setAddress] = useState("");
  const [running, setRunning] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [history, setHistory] = useState<Observation[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const needsAddress = kind === "BALANCE" || kind === "OWNED_OBJECTS";
  const needsRef = kind === "TRANSACTION";

  const switchKind = (k: string) => {
    setKind(k);
    setInputError(null);
  };

  const loadHistory = useCallback(() => {
    apiFetch<{ observations: Observation[] }>("/api/chainlens")
      .then((j) => setHistory(j.observations))
      .catch((e: Error) => setHistoryError(e.message));
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const run = async () => {
    const addr = address.trim();
    const dig = ref.trim();
    if (kind === "CHECKPOINT" && addr) {
      setInputError("You entered an address — to observe it, switch the kind to “Address balance” or “Owned objects”. “Latest checkpoint” observes the chain tip only.");
      return;
    }
    if (needsAddress && !addr) {
      setInputError("Enter your Sui address (starts with 0x) to observe it.");
      return;
    }
    if (needsAddress && !/^0x[0-9a-fA-F]/.test(addr)) {
      setInputError("That doesn't look like a Sui address — it should start with 0x followed by hex characters.");
      return;
    }
    if (needsRef && !dig) {
      setInputError("Enter a transaction digest to observe it.");
      return;
    }
    setInputError(null);
    setRunning(true);
    setResult(null);
    const body: Record<string, string> = { kind };
    if (dig) body.ref = dig;
    if (addr) body.address = addr;
    try {
      const j = await apiFetch<QueryResponse>("/api/chainlens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      setResult(j);
    } catch (e) {
      // Non-2xx ChainLens responses carry a structured ERROR result — render
      // it directly so the honest error card is preserved. Anything else
      // (gateway HTML page, network failure, rate limit without a body)
      // surfaces as the friendly apiFetch message in the same error card.
      const errBody = e instanceof ApiError ? (e.body as QueryResponse | undefined) : undefined;
      setResult(
        errBody && typeof errBody === "object" && "mode" in errBody
          ? errBody
          : { mode: "ERROR", error: "CLIENT_ERROR", detail: (e as Error).message },
      );
    } finally {
      setRunning(false);
    }
    loadHistory();
  };

  const tatumOk = status.integrations.tatum.configured;
  const account = useCurrentAccount();
  const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

  // Auto-prefill the address input with the user's OWN connected wallet when it
  // connects (never anyone else's). Only for address-based kinds and only when
  // the field is still empty, so manual edits/clears are always respected.
  useEffect(() => {
    if (account && (kind === "BALANCE" || kind === "OWNED_OBJECTS")) {
      setAddress((prev) => prev || account.address);
    }
  }, [account, kind]);

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="ChainLens"
        title="Real blockchain observations, facts first"
        sub="Queries run against Tatum's Sui gateway. Observed data is kept strictly separate from interpretation — activity on-chain never proves quality, legitimacy, or future performance."
      />

      {!tatumOk ? (
        <div className="card-surface border-conflict/30">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <p className="font-medium">Tatum gateway not configured</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                ChainLens queries the live Sui network through Tatum. Add your API key in Settings → “Tatum — Sui
                gateway” (or set TATUM_API_KEY in .env) to observe real mainnet data — RECALLOS never substitutes
                simulated chain data.
              </p>
            </div>
            <Button size="sm" onClick={onGoSettings} className="gap-2 shrink-0">
              <Settings2 className="h-4 w-4" /> Add key in Settings
            </Button>
          </div>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-xs text-verified">
          <Eye className="h-3.5 w-3.5" /> Live via Tatum — network: {status.integrations.tatum.network}
        </p>
      )}

      <Card className="border-border/70 bg-card/60">
        <CardContent className="p-5 space-y-4">
          <div className="grid-cols-1 grid gap-3 sm:grid-cols-[220px_1fr_auto]">
            <Select value={kind} onValueChange={switchKind}>
              <SelectTrigger aria-label="Observation kind"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="CHECKPOINT">Latest checkpoint</SelectItem>
                <SelectItem value="TRANSACTION">Transaction by digest</SelectItem>
                <SelectItem value="BALANCE">Address balance</SelectItem>
                <SelectItem value="OWNED_OBJECTS">Owned objects</SelectItem>
              </SelectContent>
            </Select>
            {needsRef ? (
              <Input
                value={ref}
                onChange={(e) => {
                  setRef(e.target.value);
                  setInputError(null);
                }}
                placeholder="Transaction digest"
                aria-label="Transaction digest"
                className="font-mono"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                enterKeyHint="go"
              />
            ) : (
              <Input
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setInputError(null);
                }}
                placeholder={
                  kind === "CHECKPOINT"
                    ? "0x… paste your Sui address (choose “Address balance” or “Owned objects” to observe it)"
                    : "0x… paste your Sui address"
                }
                aria-label="Sui address"
                className="font-mono"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                inputMode="text"
                enterKeyHint="go"
              />
            )}
            <Button onClick={run} disabled={running} className="gap-2">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Telescope className="h-4 w-4" />}
              Observe
            </Button>
          </div>
          {inputError ? (
            <p className="flex items-start gap-1.5 text-xs font-medium text-conflict" role="alert">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {inputError}
            </p>
          ) : null}
          {account && !needsRef ? (
            <button
              onClick={() => {
                // Fill with the connected wallet address; if the current kind
                // can't observe an address (CHECKPOINT), switch to one that can.
                if (kind === "CHECKPOINT") switchKind("BALANCE");
                setAddress(account.address);
                setInputError(null);
              }}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-verified/40 bg-verified/10 px-3 py-1.5 text-xs font-medium text-verified transition-colors hover:bg-verified/15"
              title="Fill the address input with your connected wallet address (switches to Address balance when needed)"
            >
              <Wallet className="h-3.5 w-3.5" />
              Use connected wallet <span className="font-mono">{shortAddr(account.address)}</span>
            </button>
          ) : null}
          <p className="text-[11px] text-muted-foreground">
            Observations run against the live Sui network with your own connected wallet address and your own gateway
            key — RECALLOS never observes on anyone else's behalf.
          </p>
        </CardContent>
      </Card>

      {running ? <LoadingBlock label="Observing the chain…" /> : null}
      {result?.mode === "ERROR" ? <ErrorBlock title={`Observation failed: ${result.error}`} detail={result.detail} /> : null}
      {result?.mode === "LIVE" ? (
        <Card className="border-verified/30 bg-card/60">
          <CardContent className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-verified">
                <Eye className="h-4 w-4" /> LIVE observation —{" "}
                {KIND_ICONS[result.observation.kind] ?? null}
                {KIND_LABELS[result.observation.kind] ?? result.observation.kind}
              </p>
              <span className="font-mono text-[10px] text-muted-foreground">
                {result.observation.method} · {result.observation.latencyMs}ms · {result.observation.network} ·{" "}
                {relativeTime(result.observation.observedAt)}
              </span>
            </div>
            <div className="mt-4">
              <ObservationBody
                kind={result.observation.kind}
                result={result.observation.result}
                network={result.observation.network}
              />
            </div>
            <RawResponse result={result.observation.result} />
            <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {result.interpretationNote}
            </p>
          </CardContent>
        </Card>
      ) : null}
      {result?.mode === "ERROR" && result.error === "NOT_CONFIGURED" ? (
        <div className="card-surface border-conflict/30">
          <p className="text-sm font-semibold">Gateway key required</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{result.detail}</p>
        </div>
      ) : null}

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Observation history</h3>
        {history === null && !historyError ? <LoadingBlock label="Loading history…" /> : null}
        {historyError ? <ErrorBlock title="Failed to load history" detail={historyError} /> : null}
        {history !== null && history.length === 0 ? (
          <EmptyBlock title="No observations yet" hint="Run a query above — results are recorded with timestamps and source references." />
        ) : null}
        <div className="grid-cols-1 grid gap-2">
          {(history ?? []).map((o) => (
            <div key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border/60 bg-card/50 px-3 py-2 text-xs">
              <span className="rounded border border-verified/40 bg-verified/10 px-1.5 py-0.5 text-[10px] font-semibold text-verified">LIVE</span>
              <span className="inline-flex items-center gap-1 font-medium">
                {KIND_ICONS[o.kind] ?? null}
                {KIND_LABELS[o.kind] ?? o.kind}
              </span>
              <span className="font-mono text-muted-foreground">{o.method}</span>
              <span className="text-muted-foreground">{o.network}</span>
              {o.latencyMs ? <span className="text-muted-foreground">{o.latencyMs}ms</span> : null}
              <span className="ml-auto text-muted-foreground" title={new Date(o.observedAt).toLocaleString()}>
                {relativeTime(o.observedAt)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
