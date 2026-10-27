"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, ApiError } from "@/lib/api-client";
import type { StatusPayload } from "./nav";
import { EmptyBlock, ErrorBlock, LoadingBlock, LessonStatusBadge, SectionHeader } from "./shared";
import { Beaker, CheckCircle2, Loader2, RefreshCcw, Shuffle, XCircle } from "lucide-react";

type Evidence = { kind: string; sourceRef?: string | null; summary: string };
type Lesson = {
  id: string;
  statement: string;
  category: string;
  supportingDecisions: string[];
  evidence: Evidence[];
  observationCount: number;
  confidence: string;
  status: string;
  exceptions: string[];
  appliedAt: string | null;
  reevaluatedAt: string | null;
  gate: { pass: boolean; reasons: string[] };
  createdAt: string;
};

type CompareResult = {
  question: string;
  baseline: { recommendation: string; memoriesUsed: Array<{ memoryId: string; influence: string }>; lessonsApplied: string[] };
  personalized: { recommendation: string; memoriesUsed: Array<{ memoryId: string; influence: string }>; lessonsApplied: string[] };
  personalizedTrace: { recalled: Array<{ id: string; content: string; sourceType: string }>; recallError: string | null };
  changed: boolean;
  disclosure: string[];
};

type ScenarioResult = { scenarioId: string; scenarioName: string; passed: boolean; kind: string; details: string };

const CYCLE = ["Observe", "Remember", "Recommend", "Verify", "Learn", "Apply"];

export function LearningLab({ status }: { status: StatusPayload }) {
  const { toast } = useToast();
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [lessonsError, setLessonsError] = useState<string | null>(null);
  const [compareQuestion, setCompareQuestion] = useState("Should I keep funds on an exchange this month?");
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [comparing, setComparing] = useState(false);
  const [evalResults, setEvalResults] = useState<ScenarioResult[] | null>(null);
  const [evaluating, setEvaluating] = useState(false);

  const loadLessons = useCallback(() => {
    apiFetch<{ lessons: Lesson[] }>("/api/lessons")
      .then((j) => setLessons(j.lessons))
      .catch((e: Error) => setLessonsError(e.message));
  }, []);

  useEffect(() => {
    loadLessons();
  }, [loadLessons]);

  const act = async (lessonId: string, action: string) => {
    try {
      const j = await apiFetch<{ ok: boolean; status: string }>("/api/lessons", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lessonId, action }),
      });
      toast({ title: `Lesson ${j.status.toLowerCase()}`, description: action === "promote" ? "Evidence gate passed." : undefined });
      loadLessons();
    } catch (e) {
      const gateReasons = e instanceof ApiError && Array.isArray((e.body as { reasons?: unknown } | null)?.reasons)
        ? ((e.body as { reasons: string[] }).reasons as string[])
        : null;
      if (gateReasons) {
        toast({
          title: "Promotion blocked by the evidence gate",
          description: gateReasons.join(" · "),
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Action failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const runCompare = async () => {
    setComparing(true);
    setCompare(null);
    try {
      const j = await apiFetch<CompareResult>("/api/learning/compare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: compareQuestion }),
      });
      setCompare(j);
    } catch (e) {
      toast({ title: "Comparison failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setComparing(false);
    }
  };

  const runEval = async () => {
    setEvaluating(true);
    setEvalResults(null);
    try {
      const j = await apiFetch<{ results: ScenarioResult[] }>("/api/eval", { method: "POST" });
      setEvalResults(j.results);
    } catch (e) {
      toast({ title: "Evaluation run failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setEvaluating(false);
    }
  };

  return (
    <div className="space-y-10">
      <SectionHeader
        eyebrow="Learning Lab"
        title="From memory to changed behavior — with proof"
        sub="The centerpiece: watch decisions become evidence-gated lessons, compare memory-informed recommendations against a memoryless baseline, and run the reproducible evaluation suite."
      />

      {/* Cycle */}
      <Card className="border-insight/20 bg-card/60">
        <CardContent className="p-6">
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-3">
            {CYCLE.map((step, i) => (
              <span key={step} className="flex items-center gap-2">
                <span className="flex items-center gap-2 rounded-xl border border-border bg-secondary/50 px-3 py-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-insight/15 text-[11px] font-semibold text-insight">{i + 1}</span>
                  <span className="text-sm font-medium">{step}</span>
                </span>
                {i < CYCLE.length - 1 ? <span className="text-muted-foreground">→</span> : <RefreshCcw className="h-4 w-4 text-insight" />}
              </span>
            ))}
          </div>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            {status.counters.decisionsEvaluated} evaluated outcome(s) feed {status.counters.lessons} lesson(s);
            {" "}{status.counters.lessonsApplied} currently SUPPORTED or APPLIED.
          </p>
        </CardContent>
      </Card>

      {/* Lessons */}
      <div>
        <SectionHeader
          title="Lesson lifecycle"
          sub="PROPOSED → SUPPORTED → APPLIED → REEVALUATED. Promotion is refused unless the evidence gate passes — an LLM cannot talk a lesson into being supported."
        />
        {lessons === null && !lessonsError ? <LoadingBlock label="Loading lessons…" /> : null}
        {lessonsError ? <ErrorBlock title="Failed to load lessons" detail={lessonsError} /> : null}
        {lessons !== null && lessons.length === 0 ? (
          <EmptyBlock
            title="No lessons yet"
            hint="Record a decision in the Journal and evaluate its actual outcome — that evaluation drafts the first PROPOSED lesson."
          />
        ) : null}
        <div className="grid-cols-1 grid gap-3">
          {(lessons ?? []).map((l) => (
            <Card key={l.id} className="border-border/70 bg-card/60">
              <CardContent className="p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <LessonStatusBadge status={l.status} />
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{l.category.replaceAll("_", " ")}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {l.observationCount} observation(s) · confidence {l.confidence} (computed from evidence)
                  </span>
                </div>
                <p className="mt-2.5 text-sm leading-relaxed">{l.statement}</p>

                {l.evidence.length > 0 ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                      Evidence trail ({l.evidence.length})
                    </summary>
                    <ul className="mt-2 space-y-1">
                      {l.evidence.map((e, i) => (
                        <li key={i} className={`rounded border border-border/50 p-2 text-[11px] leading-relaxed ${e.summary.startsWith("CONTRADICTION") ? "border-conflict/40 text-conflict" : ""}`}>
                          <span className="mr-1.5 rounded bg-secondary px-1 py-0.5 text-[9px] uppercase tracking-wider">{e.kind}</span>
                          {e.summary}
                          {e.sourceRef ? <span className="ml-1.5 font-mono text-[9px] text-muted-foreground">{e.sourceRef}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                {l.exceptions.length > 0 ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">Exceptions: {l.exceptions.join(" · ")}</p>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {l.status === "PROPOSED" ? (
                    <>
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => act(l.id, "promote")}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Promote to SUPPORTED
                      </Button>
                      <Button size="sm" variant="ghost" className="text-conflict" onClick={() => act(l.id, "reject")}>
                        <XCircle className="h-3.5 w-3.5" /> Reject
                      </Button>
                    </>
                  ) : null}
                  {l.status === "SUPPORTED" ? (
                    <Button size="sm" variant="outline" onClick={() => act(l.id, "apply")}>Mark as APPLIED</Button>
                  ) : null}
                  {l.status === "REEVALUATED" ? (
                    <Button size="sm" variant="outline" onClick={() => act(l.id, "reevaluate")}>Re-open as PROPOSED</Button>
                  ) : null}
                  {!l.gate.pass && l.status === "PROPOSED" ? (
                    <span className="text-[11px] text-muted-foreground">
                      Gate: needs ≥2 observations + OUTCOME evidence + zero contradictions ({l.gate.reasons.length} missing).
                    </span>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Baseline vs personalized */}
      <div>
        <SectionHeader
          title="Baseline vs memory-informed"
          sub="The same question, the same model — with and without your memories. Differences are shown with the exact memories that caused them. Controlled comparison, honestly labeled."
        />
        <Card className="border-border/70 bg-card/60">
          <CardContent className="p-5">
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input value={compareQuestion} onChange={(e) => setCompareQuestion(e.target.value)} className="h-10 flex-1" aria-label="Comparison question" />
              <Button onClick={runCompare} disabled={comparing || compareQuestion.trim().length < 4} className="h-10 gap-2">
                {comparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shuffle className="h-4 w-4" />}
                {comparing ? "Running both…" : "Compare"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {comparing ? <LoadingBlock label="Running baseline and memory-informed recommendations…" /> : null}

        {compare ? (
          <div className="mt-4 space-y-4">
            <div className="grid-cols-1 grid gap-3 lg:grid-cols-2">
              <Card className="border-border/70 bg-card/60">
                <CardContent className="p-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Baseline (no memories)</p>
                  <p className="mt-2 text-sm leading-relaxed">{compare.baseline.recommendation}</p>
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    memories used: {compare.baseline.memoriesUsed.length} · lessons applied: {compare.baseline.lessonsApplied.length}
                  </p>
                </CardContent>
              </Card>
              <Card className={compare.changed ? "border-insight/40 bg-card/60" : "border-border/70 bg-card/60"}>
                <CardContent className="p-5">
                  <p className={`text-xs font-semibold uppercase tracking-wider ${compare.changed ? "text-insight" : "text-muted-foreground"}`}>
                    Memory-informed {compare.changed ? "· CHANGED" : "· no change"}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed">{compare.personalized.recommendation}</p>
                  {compare.personalized.memoriesUsed.length > 0 ? (
                    <ul className="mt-3 space-y-1.5">
                      {compare.personalized.memoriesUsed.map((u) => {
                        const mem = compare.personalizedTrace.recalled.find((m) => m.id === u.memoryId);
                        return (
                          <li key={u.memoryId} className="rounded border border-insight/25 bg-insight/5 p-2 text-[11px] leading-relaxed">
                            <span className="text-insight">Influence:</span> {u.influence}
                            {mem ? <span className="mt-1 block text-muted-foreground">from [{mem.sourceType}] {mem.content.slice(0, 110)}…</span> : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="mt-3 text-[11px] text-muted-foreground">No memories influenced this answer — memory did not force a change.</p>
                  )}
                </CardContent>
              </Card>
            </div>
            <ul className="rounded-lg border border-border/60 bg-background/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
              {compare.disclosure.map((d, i) => (
                <li key={i}>· {d}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {/* Evaluation suite */}
      <div>
        <SectionHeader
          title="Reproducible evaluation suite"
          sub="Fixed scenarios with expected outcomes. Deterministic checks assert rule-level guarantees; model-dependent checks are labeled as such."
          right={
            <Button size="sm" variant="outline" onClick={runEval} disabled={evaluating} className="gap-1.5">
              {evaluating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Beaker className="h-3.5 w-3.5" />}
              {evaluating ? "Running…" : "Run evaluation"}
            </Button>
          }
        />
        {evaluating ? <LoadingBlock label="Running fixed scenarios…" /> : null}
        {evalResults ? (
          <div className="space-y-2">
            <p className="text-sm">
              {evalResults.filter((r) => r.passed).length}/{evalResults.length} scenarios passed
            </p>
            {evalResults.map((r) => (
              <div key={r.scenarioId} className={`rounded-lg border p-3 text-xs leading-relaxed ${r.passed ? "border-verified/30 bg-verified/5" : "border-conflict/40 bg-conflict/5"}`}>
                <p className="flex items-center gap-2 font-medium">
                  {r.passed ? <CheckCircle2 className="h-3.5 w-3.5 text-verified" /> : <XCircle className="h-3.5 w-3.5 text-conflict" />}
                  {r.scenarioId} — {r.scenarioName}
                  <span className="ml-auto rounded bg-secondary px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">{r.kind}</span>
                </p>
                <p className="mt-1 text-muted-foreground">{r.details}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyBlock title="No evaluation run in this session" hint="The suite checks retrieval relevance, verified provenance, lesson gating, conflict surfacing, persistence honesty, and claim separation." />
        )}
      </div>
    </div>
  );
}
