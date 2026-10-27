"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatusPayload } from "./nav";
import { EmptyBlock, ErrorBlock, LessonStatusBadge, LoadingBlock, RefreshButton, SectionHeader } from "./shared";
import { absoluteTime, observationShortValue, observationSummary, relativeTime } from "./observe-result";
import { useWorkspace } from "@/lib/store";
import { apiFetch } from "@/lib/api-client";
import { Activity, ArrowRight, BrainCircuit, Database, Dna, ShieldCheck, Telescope } from "lucide-react";

type ActivityItem = { id: string; kind: string; summary: string; createdAt: string };
type DecisionLite = { id: string; title: string; status: string; overallVerdict: string | null; category: string };
type LessonLite = { id: string; statement: string; status: string; confidence: string };

/** Shape of the newest row from GET /api/chainlens (resultJson already decoded). */
type LatestObservation = {
  id: string;
  kind: string;
  method: string;
  network: string;
  latencyMs: number | null;
  observedAt: string;
  result: Record<string, unknown>;
};

/** Live chain-tip probe (GET /api/chainlens?live=1) — not persisted anywhere. */
type LiveTip = {
  sequenceNumber: string;
  observedAt: string;
};

/** Everything the tile needs, already resolved from tip-or-stored-observation. */
type ObservationView = {
  key: string;
  value: string;
  summary: string | null;
  age: string;
  observedAt: string;
  fresh: boolean;
  live: boolean;
};

type DashboardData = {
  activities: ActivityItem[];
  recentDecisions: DecisionLite[];
  openLessons: LessonLite[];
};

function StatCard({ label, value, hint, icon, tone }: { label: string; value: string | number; hint?: string; icon: React.ReactNode; tone?: string }) {
  return (
    <Card className="border-border/70 bg-card/60">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
          <span className={tone ?? "text-insight"}>{icon}</span>
        </div>
        <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
        {hint ? <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

const OBS_FRESH_MS = 15 * 60_000;
const TIP_POLL_MS = 60_000;
const AGE_TICK_MS = 30_000;

/** Decode a live probe payload into the tile model; null when unusable. */
function tipFromLive(live: { kind: string; result: Record<string, unknown>; observedAt: string } | null): LiveTip | null {
  if (!live || live.kind !== "CHECKPOINT" || typeof live.result !== "object" || live.result === null) return null;
  const cp = (live.result as { latestCheckpoint?: { sequenceNumber?: unknown } }).latestCheckpoint;
  const seq = cp && typeof cp.sequenceNumber === "string" ? cp.sequenceNumber : null;
  if (!seq) return null;
  return { sequenceNumber: seq, observedAt: live.observedAt };
}

/**
 * Minimal "Latest Sui observation" tile: header + one big value + relative age.
 * Per user request everything else is hidden — no kind label, no icon tile, no
 * gateway method/latency, no network chip, no CTA, and (since the user asked
 * to remove the raw tip number) no checkpoint digits anywhere on the surface.
 *
 * The user's OWN newest observation leads — observe a wallet ("0 SUI") and
 * the tile shows that result with a pulse while it's fresh (<15 min). The
 * live chain-tip probe (re-probed every minute) fills the tile only until
 * the first observation exists, reading "Live" with a pulse — and never a
 * raw tip number (the user asked those removed). A stored CHECKPOINT also
 * degrades to "Recent"/"—" so no digits ever surface. The relative age
 * re-renders on a 30s tick so it never drifts.
 */
function LatestObservationCard({ view, loading, error, fallbackAt }: {
  view: ObservationView | null;
  loading: boolean;
  error: string | null;
  fallbackAt: string | null;
}) {
  return (
    <Card className="border-border/70 bg-card/60">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Latest Sui observation</p>
          <span className="text-insight">
            <Telescope className="h-4 w-4" />
          </span>
        </div>

        {loading && view === null ? (
          <div className="mt-3 space-y-2" aria-live="polite" aria-label="Loading latest observation">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
        ) : view !== null ? (
          <motion.div
            key={view.key}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="mt-2 min-w-0"
          >
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-2xl font-semibold tabular-nums tracking-tight" title={view.summary ?? undefined}>
                {view.value}
              </p>
              {view.fresh ? (
                <span
                  className="relative ml-auto flex h-2 w-2 shrink-0"
                  role="img"
                  aria-label={view.live ? "Live chain tip, probed just now" : "Observed within the last 15 minutes"}
                  title={view.live ? "Live chain tip, probed just now" : "Observed within the last 15 minutes"}
                >
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-verified opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-verified" />
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground" title={absoluteTime(view.observedAt)}>
              {view.age}
            </p>
          </motion.div>
        ) : (
          <div className="mt-2 min-w-0">
            <p className="text-2xl font-semibold tracking-tight text-muted-foreground">—</p>
            <p className="mt-1 truncate text-[11px] text-muted-foreground" title={error ?? undefined}>
              {error ?? (fallbackAt ? new Date(fallbackAt).toLocaleString() : "No live observation yet")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function Dashboard({ status, onRefresh }: { status: StatusPayload; onRefresh: () => void }) {
  const setView = useWorkspace((s) => s.setView);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<LatestObservation | null>(null);
  const [obsLoading, setObsLoading] = useState(true);
  const [obsError, setObsError] = useState<string | null>(null);
  const [tip, setTip] = useState<LiveTip | null>(null);

  /**
   * Live chain-tip probe — the tile must show the CURRENT latest checkpoint,
   * not a stored snapshot. A failed probe keeps the last known tip (its
   * timestamp stays honest) and the stored-observation fallback still applies.
   */
  const probeTip = useCallback(async () => {
    try {
      const j = await apiFetch<{ live: { kind: string; result: Record<string, unknown>; observedAt: string } | null }>(
        "/api/chainlens?live=1",
      );
      const next = tipFromLive(j.live);
      if (next) setTip(next);
    } catch {
      // probe failures are silent by design — the tile falls back to the
      // newest stored observation instead of showing an error
    }
  }, []);

  const load = useCallback(async () => {
    const dash = apiFetch<DashboardData>("/api/dashboard");
    // Observation history must never take the whole dashboard down on its own.
    const chain = apiFetch<{ observations: Array<Record<string, unknown>> }>("/api/chainlens").catch(() => null);
    void probeTip();
    try {
      const [d, c] = await Promise.all([dash, chain]);
      setData(d);
      setError(null);
      const raw = Array.isArray(c?.observations) && c.observations.length > 0 ? c.observations[0] : null;
      if (raw) {
        let result: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(String(raw.resultJson));
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) result = parsed as Record<string, unknown>;
        } catch {
          // unparsable payload → empty result; summary falls back to the kind label
        }
        setLatest({
          id: String(raw.id),
          kind: String(raw.kind),
          method: String(raw.method),
          network: String(raw.network),
          latencyMs: typeof raw.latencyMs === "number" ? raw.latencyMs : null,
          observedAt: String(raw.observedAt),
          result,
        });
        setObsError(null);
      } else {
        setLatest(null);
        setObsError(c === null ? "Observation history could not be loaded" : null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setObsLoading(false);
    }
  }, [probeTip]);

  useEffect(() => {
    load();
  }, [load]);

  // Keep the tile genuinely "latest": re-probe the chain tip once a minute
  // while the dashboard is visible (paused in background tabs).
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void probeTip();
    }, TIP_POLL_MS);
    return () => clearInterval(id);
  }, [probeTip]);

  // Re-render on a slow tick so the relative age ("just now" → "1 min ago")
  // stays truthful even between probes.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), AGE_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const obsView = useMemo<ObservationView | null>(() => {
    // The user's OWN newest observation leads: observe a wallet in ChainLens,
    // come back to the dashboard, and the tile shows that exact result —
    // e.g. "0 SUI · just now". Navigating back remounts this view, so the
    // newest stored row is always what was observed last.
    if (latest) {
      const fresh = Date.now() - Date.parse(latest.observedAt) < OBS_FRESH_MS;
      return {
        key: latest.id,
        // A stored CHECKPOINT snapshot would render a tip number the user
        // asked to remove, so it degrades to a number-free freshness word;
        // every other kind keeps its short value ("0 SUI", "5+", …).
        value: latest.kind === "CHECKPOINT" ? (fresh ? "Recent" : "—") : observationShortValue(latest.kind, latest.result),
        summary: latest.kind === "CHECKPOINT" ? null : observationSummary(latest.kind, latest.result),
        age: relativeTime(latest.observedAt),
        observedAt: latest.observedAt,
        fresh,
        live: false,
      };
    }
    // Nothing observed yet → the live chain-tip probe proves the pipeline is
    // alive ("Live" + pulse) without ever leaking the tip digits.
    if (tip) {
      return {
        key: `tip:${tip.sequenceNumber}`,
        value: "Live",
        summary: `Live chain tip · observed ${relativeTime(tip.observedAt)}`,
        age: relativeTime(tip.observedAt),
        observedAt: tip.observedAt,
        fresh: true,
        live: true,
      };
    }
    return null;
  }, [latest, tip, tick]);

  const c = status.counters;
  const walrusOk = status.integrations.walrus.configured;
  const tatumOk = status.integrations.tatum.configured;
  const unconfigured = !walrusOk || !tatumOk;

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Personal intelligence"
        title="Dashboard"
        right={
          <RefreshButton
            onRefresh={async () => {
              onRefresh();
              await load();
            }}
          />
        }
      />

      {unconfigured ? (
        <div className="card-surface border-insight/30 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <p className="font-medium">Guided setup</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {status.integrations.walrus.note} {status.integrations.tatum.note}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setView("settings")}>
                Connect services
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Counters */}
      <div>
        <div className="grid-cols-1 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Persistent memories"
            value={c.memoryTotal}
            hint={`${c.memoryVerified} Walrus-verified · ${c.memoryMirror} local mirror`}
            icon={<Database className="h-4 w-4" />}
          />
          <StatCard
            label="Decisions recorded"
            value={c.decisions}
            hint={`${c.decisionsEvaluated} with evaluated outcomes`}
            icon={<Dna className="h-4 w-4" />}
          />
          <StatCard
            label="Evidence-gated lessons"
            value={c.lessons}
            hint={`${c.lessonsApplied} SUPPORTED or APPLIED`}
            icon={<BrainCircuit className="h-4 w-4" />}
          />
          <LatestObservationCard
            view={obsView}
            loading={obsLoading}
            error={obsError}
            fallbackAt={c.lastObservationAt}
          />
        </div>
        {c.memoryVerified === 0 ? (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Verified memories appear here only after the real Walrus Memory integration confirms a write. Local mirrors
            are pending sync and are never counted as verified.
          </p>
        ) : null}
      </div>

      <div className="grid-cols-1 grid gap-6 lg:grid-cols-2">
        {/* Learning loop mini */}
        <Card className="border-border/70 bg-card/60">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold tracking-tight">Learning loop</h3>
              <Button variant="ghost" size="sm" onClick={() => setView("learning")} className="gap-1 text-xs">
                Open Learning Lab <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              {["Observe", "Remember", "Recommend", "Verify", "Learn", "Apply"].map((step, i) => (
                <span key={step} className="flex items-center gap-2">
                  <span className="rounded-full border border-border bg-secondary/60 px-2.5 py-1">{step}</span>
                  {i < 5 ? <span className="text-muted-foreground">→</span> : null}
                </span>
              ))}
            </div>
            {data && data.openLessons.length > 0 ? (
              <ul className="mt-4 space-y-2">
                {data.openLessons.slice(0, 3).map((l) => (
                  <li key={l.id} className="rounded-lg border border-border/60 bg-background/40 p-3 text-xs leading-relaxed">
                    <div className="mb-1 flex items-center gap-2">
                      <LessonStatusBadge status={l.status} />
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{l.status} · confidence {l.confidence}</span>
                    </div>
                    {l.statement}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-xs text-muted-foreground">
                No lessons yet. Record a decision in the Journal, then evaluate its outcome to draft the first lesson.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Recent decisions */}
        <Card className="border-border/70 bg-card/60">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold tracking-tight">Recent decisions</h3>
              <Button variant="ghost" size="sm" onClick={() => setView("journal")} className="gap-1 text-xs">
                Open Journal <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
            {data === null && !error ? <LoadingBlock label="Loading decisions…" /> : null}
            {error ? <div className="mt-4"><ErrorBlock title="Failed to load decisions" detail={error} /></div> : null}
            {data && data.recentDecisions.length === 0 ? (
              <div className="mt-4">
                <EmptyBlock
                  title="No decisions yet"
                  hint="Record your first decision with its assumptions and expected outcome — that's the raw material memory learns from."
                  action={<Button size="sm" onClick={() => setView("journal")}>Record a decision</Button>}
                />
              </div>
            ) : null}
            {data && data.recentDecisions.length > 0 ? (
              <ul className="mt-4 space-y-2">
                {data.recentDecisions.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2.5 text-sm">
                    <span className="min-w-0 truncate">{d.title}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                      {d.status}{d.overallVerdict ? ` · ${d.overallVerdict.replaceAll("_", " ")}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Activity */}
      <Card className="border-border/70 bg-card/60">
        <CardContent className="p-5">
          <h3 className="font-semibold tracking-tight">Recent activity</h3>
          {data === null && !error ? <LoadingBlock label="Loading activity…" /> : null}
          {error ? <div className="mt-4"><ErrorBlock title="Failed to load activity" detail={error} /></div> : null}
          {data && data.activities.length === 0 ? (
            <div className="mt-4">
              <EmptyBlock title="No activity yet" hint="Asking questions, writing memories, and evaluating outcomes will appear here." />
            </div>
          ) : null}
          {data && data.activities.length > 0 ? (
            <ul className="mt-4 space-y-1.5">
              {data.activities.map((a) => (
                <li key={a.id} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 text-xs hover:bg-secondary/40">
                  <Activity className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="flex-1">{a.summary}</span>
                  <span className="shrink-0 text-muted-foreground">{new Date(a.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      {c.memoryVerified > 0 ? (
        <div className="flex items-center gap-2 text-xs text-verified">
          <ShieldCheck className="h-3.5 w-3.5" />
          {c.memoryVerified} memories confirmed by the real Walrus Memory integration.
        </div>
      ) : null}
    </div>
  );
}
