"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, ApiError } from "@/lib/api-client";
import { EmptyBlock, ErrorBlock, LoadingBlock, SectionHeader, VerdictBadge } from "./shared";
import { FlaskConical, Loader2, Plus, Search } from "lucide-react";

type Verdict = { assumptionId: string; verdict: string; rationale: string };
type Assumption = { id: string; text: string };
type EvidenceRef = { kind: string; sourceRef?: string | null; summary: string };

type Decision = {
  id: string;
  category: string;
  title: string;
  question: string;
  goal: string;
  constraints: string[];
  assumptions: Assumption[];
  evidenceRefs: EvidenceRef[];
  recommendation: string;
  confidence: string;
  expectedOutcome: string;
  evaluationCriteria: string;
  reviewDate: string | null;
  actualOutcome: string | null;
  verdicts: Verdict[];
  overallVerdict: string | null;
  status: string;
  createdAt: string;
  evaluatedAt: string | null;
};

type EvaluateResponse = {
  decisionId: string;
  overallVerdict: string;
  verdicts: Verdict[];
  summary: string;
  lessonId: string | null;
  lessonStatement: string | null;
  lessonTentative: boolean;
  aiUnavailable: boolean;
};

export function Journal() {
  const { toast } = useToast();
  const [decisions, setDecisions] = useState<Decision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<Decision | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [evaluateFor, setEvaluateFor] = useState<Decision | null>(null);

  const load = useCallback(() => {
    apiFetch<{ decisions: Decision[] }>("/api/decisions")
      .then((j) => setDecisions(j.decisions))
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = (decisions ?? []).filter((d) =>
    query.trim() ? (d.title + d.question + d.category).toLowerCase().includes(query.toLowerCase()) : true,
  );

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Decision Journal"
        title="The raw material of memory"
        sub="Every decision stores its reasoning, assumptions, and expected outcome. When you later record what actually happened, each assumption gets an explicit verdict — and evidence-backed lessons emerge."
        right={
          <Button onClick={() => setCreateOpen(true)} size="sm" className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Record decision
          </Button>
        }
      />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter decisions…" className="pl-9" aria-label="Filter decisions" />
      </div>

      {decisions === null && !error ? <LoadingBlock label="Loading decisions…" /> : null}
      {error ? <ErrorBlock title="Failed to load decisions" detail={error} /> : null}
      {decisions !== null && filtered.length === 0 ? (
        <EmptyBlock
          title={query ? "No decisions match that filter" : "No decisions recorded yet"}
          hint={query ? "Try a different search term." : "Record a decision with its assumptions — later, its evaluated outcome becomes the evidence a lesson is built from."}
          action={!query ? <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Record decision</Button> : undefined}
        />
      ) : null}

      <div className="grid-cols-1 grid gap-3">
        {filtered.map((d) => (
          <Card key={d.id} className="border-border/70 bg-card/60 transition-colors hover:border-insight/25">
            <CardContent className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{d.category}</span>
                    <span className="text-[10px] text-muted-foreground">{new Date(d.createdAt).toLocaleDateString()}</span>
                  </div>
                  <button onClick={() => setDetail(d)} className="mt-1 block text-left font-medium hover:text-insight">
                    {d.title}
                  </button>
                  <p className="mt-1 line-clamp-2 max-w-2xl text-sm text-muted-foreground">{d.question}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  {d.overallVerdict ? <VerdictBadge verdict={d.overallVerdict} /> : null}
                  {d.status === "ACTIVE" ? (
                    <Button size="sm" variant="outline" onClick={() => setEvaluateFor(d)}>
                      Record outcome
                    </Button>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <CreateDecisionDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => { load(); toast({ title: "Decision recorded", description: "A summary was written through the memory policy." }); }} />
      <DetailDialog decision={detail} onClose={() => setDetail(null)} onEvaluate={(d) => { setDetail(null); setEvaluateFor(d); }} />
      <EvaluateDialog decision={evaluateFor} onClose={() => setEvaluateFor(null)} onDone={() => { load(); }} />
    </div>
  );
}

function CreateDecisionDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    title: "",
    category: "OTHER",
    question: "",
    goal: "",
    constraints: "",
    assumptions: "",
    recommendation: "",
    expectedOutcome: "",
    evaluationCriteria: "",
  });
  const [saving, setSaving] = useState(false);
  const [issues, setIssues] = useState<string[] | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    setIssues(null);
    try {
      const j = await apiFetch<Record<string, unknown>>("/api/decisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          constraints: form.constraints.split("\n").map((s) => s.trim()).filter(Boolean),
          assumptions: form.assumptions.split("\n").map((s) => s.trim()).filter(Boolean).map((text, i) => ({ id: `a${i + 1}`, text })),
          evidenceRefs: [],
          confidence: "medium",
        }),
      });
      onOpenChange(false);
      setForm({ title: "", category: "OTHER", question: "", goal: "", constraints: "", assumptions: "", recommendation: "", expectedOutcome: "", evaluationCriteria: "" });
      onCreated();
    } catch (e) {
      const validationIssues = e instanceof ApiError && Array.isArray((e.body as { issues?: unknown } | null)?.issues)
        ? ((e.body as { issues: string[] }).issues as string[])
        : null;
      if (validationIssues) setIssues(validationIssues);
      toast({ title: "Validation failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto scrollbar-thin">
        <DialogHeader>
          <DialogTitle>Record a decision</DialogTitle>
          <DialogDescription>
            Store the full Decision DNA: question, constraints, assumptions, and the expected outcome you will later
            verify. Confidence is qualitative — never a calibrated probability.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid-cols-1 grid gap-3 sm:grid-cols-[1fr_180px]">
            <div>
              <Label htmlFor="c-title">Title</Label>
              <Input id="c-title" value={form.title} onChange={set("title")} placeholder="Short decision title" />
            </div>
            <div>
              <Label htmlFor="c-category">Category</Label>
              <select id="c-category" value={form.category} onChange={set("category")} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                {["INVESTMENT", "DEV_TOOLING", "SECURITY", "LIFESTYLE", "RESEARCH", "OTHER"].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <Label htmlFor="c-question">The question you faced</Label>
            <Textarea id="c-question" value={form.question} onChange={set("question")} rows={2} />
          </div>
          <div>
            <Label htmlFor="c-goal">Goal</Label>
            <Input id="c-goal" value={form.goal} onChange={set("goal")} />
          </div>
          <div className="grid-cols-1 grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="c-constraints">Constraints (one per line)</Label>
              <Textarea id="c-constraints" value={form.constraints} onChange={set("constraints")} rows={2} />
            </div>
            <div>
              <Label htmlFor="c-assumptions">Assumptions (one per line)</Label>
              <Textarea id="c-assumptions" value={form.assumptions} onChange={set("assumptions")} rows={2} placeholder="Each becomes a checkable verdict later" />
            </div>
          </div>
          <div>
            <Label htmlFor="c-rec">Your recommendation / choice</Label>
            <Textarea id="c-rec" value={form.recommendation} onChange={set("recommendation")} rows={2} />
          </div>
          <div className="grid-cols-1 grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="c-expected">Expected outcome</Label>
              <Textarea id="c-expected" value={form.expectedOutcome} onChange={set("expectedOutcome")} rows={2} />
            </div>
            <div>
              <Label htmlFor="c-criteria">Evaluation criteria</Label>
              <Textarea id="c-criteria" value={form.evaluationCriteria} onChange={set("evaluationCriteria")} rows={2} placeholder="What evidence would confirm/refute it?" />
            </div>
          </div>
          {issues ? (
            <ul className="rounded-lg border border-conflict/30 bg-conflict/5 p-3 text-xs text-conflict">
              {issues.map((i) => (
                <li key={i}>· {i}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || form.title.length < 4 || form.question.length < 8} className="gap-1.5">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save decision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailDialog({ decision, onClose, onEvaluate }: { decision: Decision | null; onClose: () => void; onEvaluate: (d: Decision) => void }) {
  if (!decision) return null;
  return (
    <Dialog open={Boolean(decision)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto scrollbar-thin">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {decision.title}
            {decision.overallVerdict ? <VerdictBadge verdict={decision.overallVerdict} /> : null}
          </DialogTitle>
          <DialogDescription>{decision.question}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <section>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Goal</p>
            <p className="mt-1">{decision.goal}</p>
          </section>
          <section>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Constraints</p>
            {decision.constraints.length ? (
              <ul className="mt-1 space-y-1">{decision.constraints.map((c, i) => <li key={i} className="text-xs">· {c}</li>)}</ul>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">None recorded.</p>
            )}
          </section>
          <section>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Assumptions</p>
            <ul className="mt-1 space-y-1.5">
              {decision.assumptions.map((a) => {
                const v = decision.verdicts.find((x) => x.assumptionId === a.id);
                return (
                  <li key={a.id} className="rounded-lg border border-border/60 bg-background/40 p-2.5 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <span>{a.text}</span>
                      {v ? <VerdictBadge verdict={v.verdict} /> : null}
                    </div>
                    {v ? <p className="mt-1 text-[11px] text-muted-foreground">{v.rationale}</p> : null}
                  </li>
                );
              })}
            </ul>
          </section>
          <section>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recommendation (qualitative confidence: {decision.confidence})</p>
            <p className="mt-1">{decision.recommendation}</p>
          </section>
          <section className="grid-cols-1 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Expected outcome</p>
              <p className="mt-1 text-xs">{decision.expectedOutcome}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Evaluation criteria</p>
              <p className="mt-1 text-xs">{decision.evaluationCriteria}</p>
            </div>
          </section>
          {decision.actualOutcome ? (
            <section>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Actual outcome</p>
              <p className="mt-1 rounded-lg border border-border/60 bg-background/40 p-3 text-xs leading-relaxed">{decision.actualOutcome}</p>
            </section>
          ) : null}
          {decision.evidenceRefs.length > 0 ? (
            <section>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Evidence on record</p>
              <ul className="mt-1 space-y-1">
                {decision.evidenceRefs.map((e, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{e.kind}</span>
                    <span className="flex-1">{e.summary}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
        <DialogFooter>
          {decision.status === "ACTIVE" ? <Button onClick={() => onEvaluate(decision)}>Record outcome & evaluate</Button> : null}
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EvaluateDialog({ decision, onClose, onDone }: { decision: Decision | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [outcome, setOutcome] = useState("");
  const [evidence, setEvidence] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<EvaluateResponse | null>(null);

  const run = async () => {
    if (!decision || outcome.trim().length < 4) return;
    setRunning(true);
    setResult(null);
    try {
      const j = await apiFetch<EvaluateResponse>("/api/decisions/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decisionId: decision.id, actualOutcome: outcome, evidenceSummary: evidence || undefined }),
      });
      setResult(j);
      onDone();
      toast({ title: "Outcome evaluated", description: j.lessonId ? "A PROPOSED lesson was drafted from this evaluation." : "Outcome recorded." });
    } catch (e) {
      toast({ title: "Evaluation failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={Boolean(decision)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto scrollbar-thin">
        <DialogHeader>
          <DialogTitle>Record outcome</DialogTitle>
          <DialogDescription>
            Describe what actually happened for &ldquo;{decision?.title}&rdquo;. Each assumption will receive an explicit
            verdict — INCONCLUSIVE where evidence can&apos;t settle it.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">Overall:</span>
              <VerdictBadge verdict={result.overallVerdict} />
            </div>
            <p className="rounded-lg border border-border/60 bg-background/40 p-3 text-xs leading-relaxed">{result.summary}</p>
            <ul className="space-y-1.5">
              {result.verdicts.map((v) => (
                <li key={v.assumptionId} className="flex items-start justify-between gap-2 rounded-lg border border-border/60 p-2.5 text-xs">
                  <span className="flex-1">{v.rationale}</span>
                  <VerdictBadge verdict={v.verdict} />
                </li>
              ))}
            </ul>
            {result.lessonStatement ? (
              <div className="rounded-lg border border-insight/30 bg-insight/5 p-3">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-insight">
                  <FlaskConical className="h-3 w-3" /> Drafted lesson — PROPOSED (tentative: {String(result.lessonTentative)})
                </p>
                <p className="mt-1.5 text-xs leading-relaxed">{result.lessonStatement}</p>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  It needs {2} independent supporting observations and zero contradictions before it can be promoted to
                  SUPPORTED — manage it in the Learning Lab.
                </p>
              </div>
            ) : null}
            {result.aiUnavailable ? (
              <p className="text-xs text-conflict">AI evaluation was unavailable; assumptions were marked INCONCLUSIVE and the outcome was still recorded.</p>
            ) : null}
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div>
                <Label htmlFor="e-outcome">What actually happened?</Label>
                <Textarea id="e-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} rows={4} placeholder="Be specific — this becomes OUTCOME evidence." />
              </div>
              <div>
                <Label htmlFor="e-evidence">Supporting evidence (optional)</Label>
                <Input id="e-evidence" value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="e.g. pool depth fell from $410k to $160k (observed on ChainLens)" />
              </div>
              {running ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Evaluating assumptions → drafting lesson → cross-assessing existing lessons…
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={run} disabled={running || outcome.trim().length < 4} className="gap-1.5">
                {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Evaluate
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
