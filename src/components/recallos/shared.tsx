"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCcw, ShieldCheck, Info } from "lucide-react";
import type { ReactNode } from "react";

/* ------------------------------------------------------------------ */
/* Source & state badges — the honesty layer. Every record renders its */
/* true provenance; nothing can masquerade as verified.                */
/* ------------------------------------------------------------------ */

export function SourceBadge({ sourceType, storageState }: { sourceType: string; storageState?: string }) {
  if (sourceType === "WALRUS") {
    return (
      <Badge className="gap-1 bg-verified/15 text-verified border-verified/30 hover:bg-verified/15" variant="outline">
        <ShieldCheck className="h-3 w-3" /> Walrus verified
      </Badge>
    );
  }
  if (sourceType === "LOCAL_MIRROR") {
    return (
      <Badge className="gap-1 bg-memory/10 text-memory border-memory/30 hover:bg-memory/10" variant="outline">
        Local mirror{storageState === "PENDING_SYNC" ? " · pending sync" : ""}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      {sourceType}
    </Badge>
  );
}

export function LessonStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PROPOSED: "bg-muted text-muted-foreground border-border",
    SUPPORTED: "bg-verified/15 text-verified border-verified/30",
    APPLIED: "bg-insight/15 text-insight border-insight/30",
    REEVALUATED: "bg-conflict/10 text-conflict border-conflict/30",
    REJECTED: "bg-muted text-muted-foreground border-border line-through",
  };
  return <Badge variant="outline" className={map[status] ?? ""}>{status}</Badge>;
}

export function VerdictBadge({ verdict }: { verdict: string }) {
  const map: Record<string, { cls: string; icon: ReactNode }> = {
    HELD: { cls: "bg-verified/15 text-verified border-verified/30", icon: <CheckCircle2 className="h-3 w-3" /> },
    PARTIALLY_HELD: { cls: "bg-insight/15 text-insight border-insight/30", icon: <AlertTriangle className="h-3 w-3" /> },
    NOT_HELD: { cls: "bg-conflict/15 text-conflict border-conflict/30", icon: <AlertTriangle className="h-3 w-3" /> },
    INCONCLUSIVE: { cls: "bg-muted text-muted-foreground border-border", icon: <Info className="h-3 w-3" /> },
  };
  const v = map[verdict] ?? { cls: "bg-muted text-muted-foreground border-border", icon: null };
  return (
    <Badge variant="outline" className={cn("gap-1", v.cls)}>
      {v.icon} {verdict.replaceAll("_", " ")}
    </Badge>
  );
}

export function IntegrationChip({
  name,
  configured,
  onClick,
}: {
  name: string;
  configured: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
        configured ? "border-verified/40 bg-verified/10 text-verified" : "border-border bg-muted/40 text-muted-foreground hover:text-foreground",
      )}
      title={configured ? `${name} connected` : `${name} not configured — click to set up`}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", configured ? "bg-verified" : "bg-muted-foreground")} />
      {name}
      {!configured ? " off" : ""}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Honest states                                                       */
/* ------------------------------------------------------------------ */

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function SkeletonCards({ n = 3 }: { n?: number }) {
  return (
    <div className="grid-cols-1 grid gap-3">
      {Array.from({ length: n }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  );
}

export function EmptyBlock({ title, hint, action }: { title: string; hint: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed py-10 px-6 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">{hint}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorBlock({ title, detail }: { title: string; detail?: string }) {
  return (
    <Alert variant="destructive" className="border-conflict/40">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{title}</AlertTitle>
      {detail ? <AlertDescription className="font-mono text-xs opacity-80">{detail}</AlertDescription> : null}
    </Alert>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  sub,
  right,
}: {
  eyebrow?: string;
  title: string;
  sub?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
      <div>
        {eyebrow ? <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-insight">{eyebrow}</p> : null}
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {sub ? <p className="mt-1 text-sm text-muted-foreground max-w-2xl">{sub}</p> : null}
      </div>
      {right}
    </div>
  );
}

export const CARD = "card-surface p-5";

/* ------------------------------------------------------------------ */
/* Refresh button — honest busy feedback: the icon spins and the       */
/* button disables while the request is in flight, then a small        */
/* "Updated HH:MM:SS" confirmation fades in once fresh data landed.    */
/* ------------------------------------------------------------------ */

export function RefreshButton({
  onRefresh,
  label = "Refresh",
}: {
  onRefresh: () => unknown | Promise<unknown>;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const click = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onRefresh();
      setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-2.5">
      {updatedAt !== null && !busy ? (
        <span
          aria-live="polite"
          className="animate-in fade-in slide-in-from-left-1 flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground duration-300"
        >
          <CheckCircle2 className="h-3 w-3 text-verified" /> Updated {updatedAt}
        </span>
      ) : null}
      <Button variant="outline" size="sm" onClick={click} disabled={busy} className="min-w-[104px] gap-2">
        <RefreshCcw className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
        {busy ? "Refreshing…" : label}
      </Button>
    </span>
  );
}
