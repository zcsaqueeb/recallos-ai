"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import type { StatusPayload } from "./nav";
import { apiFetch } from "@/lib/api-client";
import { SectionHeader } from "./shared";
import {
  CheckCircle2,
  CircleDashed,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  PlugZap,
  RotateCcw,
  Save,
  ShieldCheck,
  XCircle,
} from "lucide-react";

/* ------------------------------- shared bits ------------------------------- */

function EnvRow({ name, needed, description }: { name: string; needed: boolean; description: string }) {
  const copy = () => navigator.clipboard?.writeText(name).catch(() => undefined);
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/40 p-3">
      {needed ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-verified" /> : <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
      <div className="min-w-0 flex-1">
        <button onClick={copy} className="flex items-center gap-1.5 font-mono text-xs font-semibold hover:text-insight" title="Copy variable name">
          {name} <Copy className="h-3 w-3 opacity-60" />
        </button>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

/* --------------------------- own-credentials card --------------------------- */

type SettingsView = {
  active: { source: "custom" | "env" | null; transport: string | null; serverUrl: string | null; namespace: string | null };
  custom: {
    present: boolean;
    delegateKeyMasked?: string;
    delegateKey?: string | null;
    accountId?: string | null;
    accountIdMasked?: string | null;
    serverUrl?: string | null;
    namespace?: string | null;
    label?: string | null;
    updatedAt?: string | null;
  };
  tatum: {
    activeSource: "custom" | "env" | null;
    gatewayUrl: string | null;
    custom: { present: boolean; keyMasked?: string; key?: string | null; label?: string | null; updatedAt?: string | null };
    env: { present: boolean; keyMasked: string | null };
  };
  env: { memwalPresent: boolean; delegateKeyMasked: string | null; accountIdMasked: string | null; serverUrl: string | null; tatumPresent: boolean; namespace: string };
};

type TestResult = {
  ok: boolean;
  stage: string;
  detail: string | null;
  gateway?: string | null;
  derived?: { publicKeyHex: string | null; suiAddress: string | null; hint: string | null };
  effective?: { namespace: string; serverUrl: string };
};

const DEFAULT_RELAYER = "https://relayer.memory.walrus.xyz";

export function OwnCredentialsCard({ status, onRefresh }: { status: StatusPayload; onRefresh: () => void }) {
  const { toast } = useToast();
  const [view, setView] = useState<SettingsView | null>(null);
  const [loading, setLoading] = useState(true);

  // Form state
  const [fKey, setFKey] = useState("");
  const [fAccount, setFAccount] = useState("");
  const [fUrl, setFUrl] = useState("");
  const [fNamespace, setFNamespace] = useState("");
  const [fLabel, setFLabel] = useState("");
  const [showKey, setShowKey] = useState(false);

  // Saved-key reveal state (view/hide)
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);

  // Actions
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const prefilled = useRef(false);

  const load = useCallback(async () => {
    try {
      const j = await apiFetch<SettingsView>("/api/settings", { cache: "no-store" });
      setView(j);
      // Prefill the editable fields once from whatever is saved (never the secret itself).
      if (!prefilled.current) {
        prefilled.current = true;
        if (j.custom.present) {
          setFAccount(j.custom.accountId ?? "");
          setFUrl(j.custom.serverUrl ?? "");
          setFNamespace(j.custom.namespace ?? "");
          setFLabel(j.custom.label ?? "");
        } else if (j.active.source === "env") {
          setFUrl(j.active.serverUrl ?? DEFAULT_RELAYER);
          setFNamespace(j.active.namespace ?? "");
        }
      }
    } catch {
      // Non-fatal — the card still renders with status-only information.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const payload = () => ({
    delegateKey: fKey.trim(),
    accountId: fAccount.trim(),
    serverUrl: fUrl.trim() || DEFAULT_RELAYER,
    namespace: fNamespace.trim(),
    label: fLabel.trim(),
  });

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const useSaved = !fKey.trim() && !fAccount.trim() && view?.custom.present;
      const body = useSaved ? { useSaved: true } : payload();
      const j = await apiFetch<TestResult>("/api/settings/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setTestResult(j);
      if (j.ok) {
        toast({ title: "Credentials verified", description: "The relayer accepted the key — safe to save." });
      }
    } catch (e) {
      setTestResult({ ok: false, stage: "network", detail: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const p = payload();
      const keepExistingKey = view?.custom.present === true && !p.delegateKey;
      const j = await apiFetch<Record<string, unknown>>("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...p, keepExistingKey }),
      });
      toast({ title: "Credentials saved — now live", description: "Memory writes now use this key. Priority: saved here → built-in .env." });
      setFKey("");
      setShowKey(false);
      setRevealedKey(null);
      prefilled.current = false;
      await load();
      onRefresh();
    } catch (e) {
      toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const revert = async () => {
    setRemoving(true);
    try {
      const j = await apiFetch<Record<string, unknown>>("/api/settings", { method: "DELETE" });
      toast({ title: "Saved credentials removed", description: "The app is back on the built-in .env credentials." });
      setRevealedKey(null);
      setTestResult(null);
      prefilled.current = false;
      await load();
      onRefresh();
    } catch (e) {
      toast({ title: "Revert failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setRemoving(false);
    }
  };

  const revealSaved = async () => {
    if (revealedKey) {
      setRevealedKey(null);
      return;
    }
    setRevealing(true);
    try {
      const j = await apiFetch<SettingsView>("/api/settings?reveal=1", { cache: "no-store" });
      setRevealedKey(j.custom.delegateKey ?? null);
      if (!j.custom.delegateKey) toast({ title: "Nothing to reveal", description: "No delegate key is saved in Settings." });
    } catch (e) {
      toast({ title: "Could not reveal the key", description: (e as Error).message, variant: "destructive" });
    } finally {
      setRevealing(false);
    }
  };

  const copyText = (t: string) => navigator.clipboard?.writeText(t).catch(() => undefined);

  const walrus = status.integrations.walrus;
  const activeSource = view?.active.source ?? (walrus.customSaved ? "custom" : walrus.source);
  const sourcePill =
    activeSource === "custom"
      ? view?.custom.present
        ? { text: "Using YOUR saved credentials", cls: "text-verified", icon: <ShieldCheck className="h-3.5 w-3.5" /> }
        : // "custom" here comes from a standalone saved Tatum key powering the Storage API fallback.
          { text: "Using your saved Tatum key (Storage API fallback)", cls: "text-verified", icon: <ShieldCheck className="h-3.5 w-3.5" /> }
      : activeSource === "env"
        ? { text: "Using built-in .env credentials", cls: "text-insight", icon: <KeyRound className="h-3.5 w-3.5" /> }
        : { text: "No credentials active", cls: "text-muted-foreground", icon: <CircleDashed className="h-3.5 w-3.5" /> };

  return (
    <Card className="border-border/70 bg-card/60">
      <CardContent className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 font-semibold tracking-tight">
            <KeyRound className="h-4 w-4 text-insight" /> Your Walrus Memory credentials
          </h3>
          <span className={`flex items-center gap-1.5 text-xs ${sourcePill.cls}`}>
            {sourcePill.icon} {sourcePill.text}
          </span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Paste your own delegate key, account id and relayer URL — they are saved server-side and used for every memory
          write and recall. Priority: <span className="font-medium text-foreground">saved here</span> →{" "}
          <span className="font-medium text-foreground">built-in .env</span> → not configured. Removing the saved set
          instantly reverts to .env.
        </p>

        {/* Saved set summary */}
        {loading ? (
          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading saved credentials…
          </div>
        ) : view?.custom.present ? (
          <div className="mt-4 space-y-2 rounded-lg border border-verified/30 bg-verified/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-foreground">
                Saved set {view.custom.label ? <span className="text-muted-foreground">· {view.custom.label}</span> : null}
                {view.custom.updatedAt ? <span className="text-muted-foreground"> · updated {new Date(view.custom.updatedAt).toLocaleString()}</span> : null}
              </p>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={revealSaved} disabled={revealing} className="h-7 gap-1.5 px-2 text-xs">
                  {revealing ? <Loader2 className="h-3 w-3 animate-spin" /> : revealedKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  {revealedKey ? "Hide key" : "View key"}
                </Button>
                {revealedKey ? (
                  <Button size="sm" variant="ghost" onClick={() => copyText(revealedKey)} className="h-7 gap-1.5 px-2 text-xs">
                    <Copy className="h-3 w-3" /> Copy
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="grid gap-1 font-mono text-[11px] text-muted-foreground sm:grid-cols-2">
              <p>
                key: <span className="text-foreground">{revealedKey ?? view.custom.delegateKeyMasked}</span>
              </p>
              <p>
                account: <span className="text-foreground">{view.custom.accountId}</span>
              </p>
              <p>
                relayer: <span className="text-foreground">{view.custom.serverUrl}</span>
              </p>
              <p>
                namespace: <span className="text-foreground">{view.custom.namespace ?? "default"}</span>
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-border/60 bg-background/40 p-3 text-xs leading-relaxed text-muted-foreground">
            {view?.env.memwalPresent
              ? `Nothing saved here yet — the app runs on the built-in .env set (key ${view.env.delegateKeyMasked} · account ${view.env.accountIdMasked}, masked; edit .env to change it). Saving below overrides it.`
              : "Nothing saved here yet, and no complete MemWal set exists in .env. Save your credentials below to enable the relayer transport."}
          </div>
        )}

        {/* Form */}
        <div className="mt-4 grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="walrus-key" className="text-xs">
              Delegate private key <span className="text-muted-foreground">(64 hex chars — the PRIVATE key, never the public one)</span>
            </Label>
            <div className="flex gap-2">
              <Input
                id="walrus-key"
                type={showKey ? "text" : "password"}
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                placeholder={view?.custom.present ? `Saved: ${view.custom.delegateKeyMasked} — leave empty to keep it` : "e.g. 7b0461930482…"}
                value={fKey}
                onChange={(e) => setFKey(e.target.value)}
                className="font-mono text-xs"
              />
              <Button type="button" variant="outline" size="icon" onClick={() => setShowKey((s) => !s)} title={showKey ? "Hide" : "Show"} className="shrink-0">
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="grid-cols-1 grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="walrus-account" className="text-xs">
                Account ID <span className="text-muted-foreground">(0x… MemWalAccount object id)</span>
              </Label>
              <Input id="walrus-account" autoComplete="off" spellCheck={false} placeholder="0x9451b08a68feca67…" value={fAccount} onChange={(e) => setFAccount(e.target.value)} className="font-mono text-xs" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="walrus-url" className="text-xs">
                Relayer URL
              </Label>
              <Input id="walrus-url" autoComplete="off" spellCheck={false} placeholder={DEFAULT_RELAYER} value={fUrl} onChange={(e) => setFUrl(e.target.value)} className="font-mono text-xs" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="walrus-ns" className="text-xs">
                Namespace <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input id="walrus-ns" autoComplete="off" spellCheck={false} placeholder="recallos" value={fNamespace} onChange={(e) => setFNamespace(e.target.value)} className="font-mono text-xs" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="walrus-label" className="text-xs">
                Label <span className="text-muted-foreground">(optional, for you)</span>
              </Label>
              <Input id="walrus-label" autoComplete="off" placeholder="e.g. Primary delegate key" value={fLabel} onChange={(e) => setFLabel(e.target.value)} className="text-xs" />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={test} disabled={testing} className="gap-1.5">
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />} Test connection
          </Button>
          <Button size="sm" onClick={save} disabled={saving || (!fKey.trim() && !view?.custom.present)} className="gap-1.5">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save &amp; use
          </Button>
          <Button size="sm" variant="ghost" onClick={revert} disabled={removing || !view?.custom.present} className="gap-1.5 text-conflict">
            {removing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Revert to .env
          </Button>
          {view?.custom.present && !fKey.trim() ? <span className="text-[11px] text-muted-foreground">Saving keeps the stored key unless you type a new one.</span> : null}
        </div>

        {/* Test result */}
        {testResult ? (
          <div className={`mt-3 rounded-lg border p-3 text-xs leading-relaxed ${testResult.ok ? "border-verified/40 bg-verified/5" : "border-conflict/40 bg-conflict/5"}`}>
            <p className={`flex items-center gap-1.5 font-medium ${testResult.ok ? "text-verified" : "text-conflict"}`}>
              {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
              {testResult.ok ? "Relayer authenticated — credentials work" : "Test failed"}
            </p>
            {testResult.detail ? <p className="mt-1 break-words text-muted-foreground">{testResult.detail}</p> : null}
            {testResult.derived?.suiAddress ? (
              <div className="mt-2 space-y-0.5 font-mono text-[11px] text-muted-foreground">
                <p>
                  derived public key: <span className="text-foreground">{testResult.derived.publicKeyHex?.slice(0, 16)}…</span>
                </p>
                <p>
                  derived Sui address: <span className="text-foreground">{testResult.derived.suiAddress}</span>
                </p>
                <p className="font-sans">{testResult.derived.hint}</p>
              </div>
            ) : null}
          </div>
        ) : null}

        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          Security: credentials are stored server-side in the app database and used only by the server. The key is always
          returned masked; the &ldquo;View key&rdquo; button is the only way to see it, and it never appears in logs.
          .env values stay masked permanently — edit the file to change them.
        </p>
      </CardContent>
    </Card>
  );
}

/* ------------------------- tatum own-key card ------------------------- */

export function TatumCredentialsCard({ status, onRefresh }: { status: StatusPayload; onRefresh: () => void }) {
  const { toast } = useToast();
  const [view, setView] = useState<SettingsView | null>(null);
  const [loading, setLoading] = useState(true);

  // Form state
  const [fKey, setFKey] = useState("");
  const [fLabel, setFLabel] = useState("");
  const [showKey, setShowKey] = useState(false);

  // Saved-key reveal state (view/hide)
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);

  // Actions
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const load = useCallback(async () => {
    try {
      const j = await apiFetch<SettingsView>("/api/settings", { cache: "no-store" });
      setView(j);
    } catch {
      // Non-fatal — the card still renders with status-only information.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const useSaved = !fKey.trim() && view?.tatum.custom.present;
      const body = useSaved ? { kind: "tatum", useSaved: true } : { kind: "tatum", apiKey: fKey.trim() };
      const j = await apiFetch<TestResult>("/api/settings/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setTestResult(j);
      if (j.ok) {
        toast({ title: "Tatum key verified", description: "The Sui gateway accepted the key — safe to save." });
      }
    } catch (e) {
      setTestResult({ ok: false, stage: "network", detail: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const keepExistingTatumKey = view?.tatum.custom.present === true && !fKey.trim();
      const j = await apiFetch<Record<string, unknown>>("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "tatum", apiKey: fKey.trim(), label: fLabel.trim(), keepExistingTatumKey }),
      });
      toast({ title: "Tatum key saved — now live", description: "ChainLens and the Walrus fallback transport now use this key. Priority: saved here → built-in .env." });
      setFKey("");
      setShowKey(false);
      setRevealedKey(null);
      setTestResult(null);
      await load();
      onRefresh();
    } catch (e) {
      toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const revert = async () => {
    setRemoving(true);
    try {
      const j = await apiFetch<Record<string, unknown>>("/api/settings?scope=tatum", { method: "DELETE" });
      toast({ title: "Saved Tatum key removed", description: "The app is back on the built-in .env TATUM_API_KEY." });
      setRevealedKey(null);
      setTestResult(null);
      await load();
      onRefresh();
    } catch (e) {
      toast({ title: "Revert failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setRemoving(false);
    }
  };

  const revealSaved = async () => {
    if (revealedKey) {
      setRevealedKey(null);
      return;
    }
    setRevealing(true);
    try {
      const j = await apiFetch<SettingsView>("/api/settings?reveal=1", { cache: "no-store" });
      setRevealedKey(j.tatum.custom.key ?? null);
      if (!j.tatum.custom.key) toast({ title: "Nothing to reveal", description: "No Tatum API key is saved in Settings." });
    } catch (e) {
      toast({ title: "Could not reveal the key", description: (e as Error).message, variant: "destructive" });
    } finally {
      setRevealing(false);
    }
  };

  const copyText = (t: string) => navigator.clipboard?.writeText(t).catch(() => undefined);

  const tatumStatus = status.integrations.tatum;
  const activeSource = view?.tatum.activeSource ?? (tatumStatus.customSaved ? "custom" : tatumStatus.source);
  const sourcePill =
    activeSource === "custom"
      ? { text: "Using YOUR saved Tatum key", cls: "text-verified", icon: <ShieldCheck className="h-3.5 w-3.5" /> }
      : activeSource === "env"
        ? { text: "Using built-in .env key", cls: "text-insight", icon: <KeyRound className="h-3.5 w-3.5" /> }
        : { text: "No key active", cls: "text-muted-foreground", icon: <CircleDashed className="h-3.5 w-3.5" /> };

  return (
    <Card className="border-border/70 bg-card/60">
      <CardContent className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 font-semibold tracking-tight">
            <KeyRound className="h-4 w-4 text-insight" /> Your Tatum — Sui gateway key
          </h3>
          <span className={`flex items-center gap-1.5 text-xs ${sourcePill.cls}`}>
            {sourcePill.icon} {sourcePill.text}
          </span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Paste your own Tatum API key — it is saved server-side and used for every Sui GraphQL query (ChainLens) and the
          Walrus Storage API fallback transport. Priority: <span className="font-medium text-foreground">saved here</span> →{" "}
          <span className="font-medium text-foreground">built-in .env</span> → not configured. Removing the saved key
          instantly reverts to .env.
        </p>

        {/* Saved key summary */}
        {loading ? (
          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading saved key…
          </div>
        ) : view?.tatum.custom.present ? (
          <div className="mt-4 space-y-2 rounded-lg border border-verified/30 bg-verified/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-foreground">
                Saved key {view.tatum.custom.label ? <span className="text-muted-foreground">· {view.tatum.custom.label}</span> : null}
                {view.tatum.custom.updatedAt ? <span className="text-muted-foreground"> · updated {new Date(view.tatum.custom.updatedAt).toLocaleString()}</span> : null}
              </p>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={revealSaved} disabled={revealing} className="h-7 gap-1.5 px-2 text-xs">
                  {revealing ? <Loader2 className="h-3 w-3 animate-spin" /> : revealedKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  {revealedKey ? "Hide key" : "View key"}
                </Button>
                {revealedKey ? (
                  <Button size="sm" variant="ghost" onClick={() => copyText(revealedKey)} className="h-7 gap-1.5 px-2 text-xs">
                    <Copy className="h-3 w-3" /> Copy
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="grid-cols-1 grid gap-1 font-mono text-[11px] text-muted-foreground">
              <p>
                api key: <span className="text-foreground">{revealedKey ?? view.tatum.custom.keyMasked}</span>
              </p>
              <p>
                gateway: <span className="text-foreground">{view.tatum.gatewayUrl ?? "https://sui-mainnet-grpc.gateway.tatum.io"}</span>
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-border/60 bg-background/40 p-3 text-xs leading-relaxed text-muted-foreground">
            {view?.tatum.env.present
              ? `Nothing saved here yet — the app runs on the built-in .env key (${view.tatum.env.keyMasked}, masked; edit .env to change it). Saving below overrides it.`
              : "Nothing saved here yet, and no TATUM_API_KEY exists in .env. Save your key below to enable live Sui data."}
          </div>
        )}

        {/* Form */}
        <div className="mt-4 grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="tatum-key" className="text-xs">
              Tatum API key <span className="text-muted-foreground">(single opaque token — official keys start with &ldquo;t-&rdquo;)</span>
            </Label>
            <div className="flex gap-2">
              <Input
                id="tatum-key"
                type={showKey ? "text" : "password"}
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                placeholder={view?.tatum.custom.present ? `Saved: ${view.tatum.custom.keyMasked} — leave empty to keep it` : "e.g. t-6a18012798b5…"}
                value={fKey}
                onChange={(e) => setFKey(e.target.value)}
                className="font-mono text-xs"
              />
              <Button type="button" variant="outline" size="icon" onClick={() => setShowKey((s) => !s)} title={showKey ? "Hide" : "Show"} className="shrink-0">
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="grid gap-1.5 sm:max-w-xs">
            <Label htmlFor="tatum-label" className="text-xs">
              Label <span className="text-muted-foreground">(optional, for you)</span>
            </Label>
            <Input id="tatum-label" autoComplete="off" placeholder="e.g. Personal portal key" value={fLabel} onChange={(e) => setFLabel(e.target.value)} className="text-xs" />
          </div>
        </div>

        {/* Actions */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={test} disabled={testing || (!fKey.trim() && !view?.tatum.custom.present)} className="gap-1.5">
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />} Test connection
          </Button>
          <Button size="sm" onClick={save} disabled={saving || (!fKey.trim() && !view?.tatum.custom.present)} className="gap-1.5">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save &amp; use
          </Button>
          <Button size="sm" variant="ghost" onClick={revert} disabled={removing || !view?.tatum.custom.present} className="gap-1.5 text-conflict">
            {removing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Revert to .env
          </Button>
          {view?.tatum.custom.present && !fKey.trim() ? <span className="text-[11px] text-muted-foreground">Saving keeps the stored key unless you type a new one.</span> : null}
        </div>

        {/* Test result */}
        {testResult ? (
          <div className={`mt-3 rounded-lg border p-3 text-xs leading-relaxed ${testResult.ok ? "border-verified/40 bg-verified/5" : "border-conflict/40 bg-conflict/5"}`}>
            <p className={`flex items-center gap-1.5 font-medium ${testResult.ok ? "text-verified" : "text-conflict"}`}>
              {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
              {testResult.ok ? "Gateway authenticated — key works" : "Test failed"}
            </p>
            {testResult.detail ? <p className="mt-1 break-words text-muted-foreground">{testResult.detail}</p> : null}
            {testResult.gateway ? (
              <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                gateway: <span className="text-foreground">{testResult.gateway}</span>
              </p>
            ) : null}
          </div>
        ) : null}

        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          Security: the key is stored server-side in the app database and sent only as x-api-key gRPC metadata from the
          server — it never reaches the browser bundle. It is always returned masked; the &ldquo;View key&rdquo; button is
          the only way to see it. .env values stay masked permanently — edit the file to change them.
        </p>
      </CardContent>
    </Card>
  );
}

/* ------------------------------- main view ------------------------------- */

export function Settings({ status, onRefresh }: { status: StatusPayload; onRefresh: () => void }) {
  const walrus = status.integrations.walrus;
  const tatum = status.integrations.tatum;

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Settings"
        title="Integrations & data"
        sub="This page always shows the true state of the integrations — if something says connected, it is actually connected."
      />

      {/* Your own credentials */}
      <OwnCredentialsCard status={status} onRefresh={onRefresh} />

      {/* Your own Tatum — Sui gateway key */}
      <TatumCredentialsCard status={status} onRefresh={onRefresh} />

      {/* Walrus */}
      <Card className="border-border/70 bg-card/60">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold tracking-tight">Walrus Memory — transport status</h3>
            <span className={`flex items-center gap-1.5 text-xs ${walrus.configured && walrus.live ? "text-verified" : walrus.configured ? "text-insight" : "text-muted-foreground"}`}>
              {walrus.configured && walrus.live ? <ShieldCheck className="h-3.5 w-3.5" /> : <CircleDashed className="h-3.5 w-3.5" />}
              {walrus.configured && walrus.live
                ? walrus.transport === "memwal-sdk"
                  ? "Live — Walrus Memory relayer"
                  : "Live — Tatum Storage API"
                : walrus.configured && walrus.transport === "memwal-sdk"
                  ? "MemWal auth failed — Tatum fallback active"
                  : walrus.configured
                    ? "Configured"
                    : "Not configured"}
            </span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{walrus.note}</p>
          <div className="mt-3 grid gap-2">
            <EnvRow
              name="WALRUS_MEMORY_DELEGATE_KEY"
              needed={!walrus.missingEnv.includes("WALRUS_MEMORY_DELEGATE_KEY")}
              description="Ed25519 delegate key (hex) from your Walrus Memory account — the .env fallback layer. Credentials saved in the form above take precedence. Accepts the MEMWAL_PRIVATE_KEY alias from the official docs."
            />
            <EnvRow
              name="WALRUS_MEMORY_ACCOUNT_ID"
              needed={!walrus.missingEnv.includes("WALRUS_MEMORY_ACCOUNT_ID")}
              description="Your MemWal account object id on Sui (the id in .env resolves to a real 0x…::account::MemWalAccount shared object on mainnet). Ownership is enforced onchain."
            />
            <EnvRow
              name="WALRUS_MEMORY_SERVER_URL"
              needed={!walrus.missingEnv.includes("WALRUS_MEMORY_SERVER_URL")}
              description="Relayer service URL — currently https://relayer.memory.walrus.xyz (official mainnet relayer, health ok, API 1.0.0)."
            />
            <EnvRow
              name="WALRUS_MEMORY_NAMESPACE"
              needed={Boolean(walrus.namespace)}
              description={`Namespace for memory operations (currently: ${walrus.namespace ?? "recallos"}). Memory scopes are owner + namespace. A namespace saved in the form above overrides this.`}
            />
            <EnvRow
              name="TATUM_API_KEY"
              needed={walrus.configured}
              description="Fallback transport — the same server-side key that powers Sui GraphQL also certifies memory blobs to Walrus mainnet via the Tatum Storage API when the MemWal relayer is unavailable."
            />
          </div>
          <div className="mt-3 rounded-lg border border-border/60 bg-background/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">How Walrus verification works:</p>
            <ol className="list-inside list-decimal space-y-0.5">
              <li>Primary (MemWal relayer): each memory is embedded, encrypted, and stored on Walrus by the relayer — the write is confirmed only when the relayer returns a Walrus blob id.</li>
              <li>Fallback (Tatum Storage API): the blob is staged via <code className="font-mono">POST /v4/data/storage/upload</code> and polled until CERTIFIED on-chain (register + certify transactions on Sui, ~10–30 s observed).</li>
              <li>Only confirmed writes show &ldquo;Walrus verified&rdquo; — verified records carry the real Walrus blob id, and failures stay LOCAL_MIRROR (pending sync), never claimed as verified.</li>
              <li>Recall merges semantic results from the relayer (or certified blobs from the public aggregator) — retrieval failures are disclosed, never faked.</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      {/* Tatum */}
      <Card className="border-border/70 bg-card/60">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold tracking-tight">Tatum — Sui gateway</h3>
            <span className={`flex items-center gap-1.5 text-xs ${tatum.configured ? "text-verified" : "text-muted-foreground"}`}>
              {tatum.configured ? <ShieldCheck className="h-3.5 w-3.5" /> : <CircleDashed className="h-3.5 w-3.5" />}
              {tatum.configured ? `Configured (${tatum.network})` : "Not configured"}
            </span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{tatum.note}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Key source: {tatum.customSaved ? "saved in Settings by you (editable in the form above)" : "built-in .env (your own key can be saved in the form above)"}.
          </p>
          <div className="mt-3 grid gap-2">
            <EnvRow
              name="TATUM_SUI_NETWORK"
              needed={tatum.networkEnvSet}
              description={
                tatum.networkEnvSet
                  ? `Set in .env → ${tatum.network}. mainnet | testnet | devnet. Gateway: https://sui-${tatum.network}-grpc.gateway.tatum.io`
                  : `Not set — optional, defaults to mainnet (currently: ${tatum.network}). Gateway: https://sui-${tatum.network}-grpc.gateway.tatum.io`
              }
            />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            Verified interface: Sui gRPC (Protocol Buffers over HTTP/2) on sui-{tatum.network}-grpc.gateway.tatum.io with
            x-api-key metadata — the official path after the Sui Foundation deprecated legacy JSON-RPC in favor of gRPC
            and GraphQL, and Tatum transitioned its Sui infra to the gRPC gateway. Operations: latest checkpoint
            (LedgerService), transaction by digest, coin balances and owned objects (StateService) — all live-verified
            with real mainnet responses. Proto contracts: vendor/sui-grpc-proto (MystenLabs/sui-apis).
          </p>
        </CardContent>
      </Card>

      {/* Security notes */}
      <Card className="border-border/70 bg-card/60">
        <CardContent className="p-5">
          <h3 className="flex items-center gap-2 font-semibold tracking-tight">
            <KeyRound className="h-4 w-4 text-insight" /> Security posture
          </h3>
          <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
            <li>· Credentials come from two layers, both server-side only: sets saved through this Settings UI (stored in the app database, returned masked, revealed only on your explicit click) and environment variables (.env is git-ignored; .env.example carries placeholders only). The UI layer always wins when present.</li>
            <li>· The delegate key from the UI is used to sign relayer requests server-side — it is never bundled into client JavaScript and never written to logs.</li>
            <li>· Blockchain operations are strictly read-only; no transactions are signed and no seed phrase is ever requested.</li>
            <li>· Wallet connection is browser-only (Sui Wallet Standard, plus injection-fallback detection for installed wallets like Bitget or OKX that do not announce themselves via the standard): the connected address stays in your browser, no signature is ever requested, and the address reaches the server only when you run a ChainLens observation with it.</li>
            <li>· Memories, web content, and chain metadata are treated as untrusted input and wrapped in injection guards.</li>
            <li>· Expensive endpoints (ask, compare, evaluate, chain queries) are rate-limited per client.</li>
            <li>· This sandbox build resolves a single server-side workspace identity; production multi-user requires real auth (documented in docs/ARCHITECTURE.md).</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
