"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { StatusPayload } from "./nav";
import { ErrorBlock, SectionHeader, SourceBadge } from "./shared";
import { useWorkspace } from "@/lib/store";
import { apiFetch } from "@/lib/api-client";
import { BookOpen, CircleAlert, Eye, FilePlus2, Lightbulb, Loader2, MessagesSquare, Search, Send, ShieldCheck, Shuffle } from "lucide-react";

type AskAnswer = {
  recommendation: string;
  uncertainty: { level: string; why: string };
  verifiedFacts: string[];
  assumptions: string[];
  inferences: string[];
  unknowns: string[];
  memoriesUsed: Array<{ memoryId: string; influence: string }>;
  lessonsApplied: string[];
  wouldChangeIf: string;
};

type AskTrace = {
  recalled: Array<{ id: string; category: string; content: string; sourceType: string; storageState?: string; conflictWith: string[]; evidence?: { blobId: string; aggregatorUrl: string; explorerUrl: string; transport: string } | null }>;
  recallError: string | null;
  conflicts: Array<{ a: string; b: string }>;
  evidence: { mode: string; sourceRef?: string; note?: string; error?: string };
  lessonsAvailable: Array<{ id: string; statement: string; status: string }>;
  walrusConfigured: boolean;
  tatumConfigured: boolean;
};

type AskResult = { answer: AskAnswer; trace: AskTrace; baseline: boolean };

const SUGGESTIONS = [
  "Should I switch my blog from WordPress to a static site generator?",
  "I have $500 to allocate — should I enter the new token launch on Sui?",
  "How should I think about keeping funds on an exchange this month?",
];

const SECTIONS: Array<{ key: keyof AskAnswer; title: string; tone: string; icon: React.ReactNode }> = [
  { key: "verifiedFacts", title: "Verified facts", tone: "text-verified", icon: <Eye className="h-3.5 w-3.5" /> },
  { key: "assumptions", title: "Assumptions", tone: "text-conflict", icon: <CircleAlert className="h-3.5 w-3.5" /> },
  { key: "inferences", title: "Inferences", tone: "text-insight", icon: <Lightbulb className="h-3.5 w-3.5" /> },
  { key: "unknowns", title: "Unknowns", tone: "text-muted-foreground", icon: <Search className="h-3.5 w-3.5" /> },
];

export function Ask({ status }: { status: StatusPayload }) {
  const setView = useWorkspace((s) => s.setView);
  const { toast } = useToast();
  const [question, setQuestion] = useState("");
  const [includeChain, setIncludeChain] = useState(false);
  const [suiRef, setSuiRef] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);

  const ask = async (q: string) => {
    if (q.trim().length < 4) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const j = await apiFetch<AskResult>("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, includeBlockchainEvidence: includeChain, suiRef: suiRef || undefined }),
      });
      setResult(j);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Ask RECALLOS"
        title="Recommendations grounded in your memory"
        sub="Relevant memories are recalled, fresh evidence can be fetched via ChainLens, and every answer separates facts, assumptions, inferences, and unknowns."
      />

      <Card className="border-border/70 bg-card/60">
        <CardContent className="p-5 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !loading && ask(question)}
              placeholder="Ask a decision question…"
              className="h-11 flex-1"
              aria-label="Your question"
            />
            <Button onClick={() => ask(question)} disabled={loading || question.trim().length < 4} className="h-11 gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {loading ? "Thinking…" : "Ask"}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={includeChain} onCheckedChange={setIncludeChain} aria-label="Include blockchain evidence" />
              Fetch Sui evidence via ChainLens
            </label>
            {includeChain ? (
              <Input
                value={suiRef}
                onChange={(e) => setSuiRef(e.target.value)}
                placeholder="Optional: digest or 0x address"
                className="h-9 w-full text-xs sm:w-64"
              />
            ) : null}
            {!status.integrations.tatum.configured ? (
              <span className="text-[11px] text-conflict">Tatum not configured — on-chain evidence is unavailable. Add a gateway key in Settings.</span>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setQuestion(s);
                  ask(s);
                }}
                className="rounded-full border border-border bg-secondary/50 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground hover:border-insight/40"
              >
                {s}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <Card className="border-border/70 bg-card/60">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Recalling memories → checking evidence → composing recommendation…
            </div>
          </CardContent>
        </Card>
      ) : null}

      {error ? <ErrorBlock title="The question could not be answered" detail={error} /> : null}

      {result ? (
        <div className="grid-cols-1 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          {/* Answer */}
          <div className="space-y-4">
            <Card className="border-insight/25 bg-card/60">
              <CardContent className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-insight">Recommendation</h3>
                  <span className="rounded-full border border-border bg-secondary/60 px-2.5 py-1 text-[11px]">
                    uncertainty: {result.answer.uncertainty.level}
                  </span>
                </div>
                <p className="mt-3 text-[15px] leading-relaxed">{result.answer.recommendation}</p>
                <p className="mt-2 text-xs text-muted-foreground">{result.answer.uncertainty.why}</p>
                <p className="mt-3 rounded-lg bg-background/50 p-3 text-xs leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">Would change if: </span>
                  {result.answer.wouldChangeIf}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setSaveOpen(true)}>
                    <FilePlus2 className="h-3.5 w-3.5" /> Save as decision
                  </Button>
                  <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setView("learning")}>
                    <Shuffle className="h-3.5 w-3.5" /> Compare vs baseline
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="grid-cols-1 grid gap-3 sm:grid-cols-2">
              {SECTIONS.map((s) => {
                const items = result.answer[s.key] as string[];
                return (
                  <Card key={s.key} className="border-border/70 bg-card/60">
                    <CardContent className="p-4">
                      <p className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${s.tone}`}>
                        {s.icon} {s.title}
                      </p>
                      {items.length === 0 ? (
                        <p className="mt-2 text-xs text-muted-foreground">None identified.</p>
                      ) : (
                        <ul className="mt-2 space-y-1.5">
                          {items.map((item, i) => (
                            <li key={i} className="text-xs leading-relaxed text-foreground/90">
                              · {item}
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* Trace */}
          <div className="space-y-4">
            <Card className="border-border/70 bg-card/60">
              <CardContent className="p-5">
                <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                  <MessagesSquare className="h-4 w-4 text-memory" /> Memories recalled ({result.trace.recalled.length})
                </h3>
                {result.trace.recallError ? (
                  <p className="mt-2 rounded-lg border border-conflict/30 bg-conflict/5 p-2.5 text-xs text-conflict">
                    Walrus recall failed: {result.trace.recallError} — the answer used only the local durable store.
                  </p>
                ) : null}
                {result.trace.recalled.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    No relevant memories. The recommendation was made without personal context.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {result.trace.recalled.map((m) => (
                      <li key={m.id} className="rounded-lg border border-border/60 bg-background/40 p-3 text-xs">
                        <div className="mb-1 flex items-center gap-2">
                          <SourceBadge sourceType={m.sourceType} storageState={m.storageState} />
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{m.category}</span>
                          {m.conflictWith.length > 0 ? (
                            <span className="text-[10px] font-medium text-conflict">conflicts with {m.conflictWith.length}</span>
                          ) : null}
                          {m.storageState === "VERIFIED" ? (
                            <a
                              href={m.evidence?.explorerUrl ?? `https://walruscan.com/mainnet/blob/${m.evidence?.blobId ?? ""}`}
                              target="_blank"
                              rel="noreferrer"
                              className="ml-auto flex items-center gap-0.5 rounded px-1 py-1 text-[10px] font-medium text-verified underline-offset-2 hover:underline"
                            >
                              <ShieldCheck className="h-3 w-3" /> Walrus proof ↗
                            </a>
                          ) : null}
                        </div>
                        {m.content}
                        {result.answer.memoriesUsed.find((u) => u.memoryId === m.id) ? (
                          <p className="mt-1.5 border-t border-border/50 pt-1.5 text-[11px] text-insight">
                            Influence: {result.answer.memoriesUsed.find((u) => u.memoryId === m.id)?.influence}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                {result.trace.conflicts.length > 0 ? (
                  <p className="mt-3 text-xs text-conflict">
                    {result.trace.conflicts.length} conflicting memory pair(s) detected — surfaced, not silently resolved.
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <Card className="border-border/70 bg-card/60">
              <CardContent className="p-5">
                <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                  <BookOpen className="h-4 w-4 text-verified" /> Evidence & lessons
                </h3>
                <p className="mt-2 text-xs leading-relaxed">
                  <span className="font-medium">Evidence mode: </span>
                  {result.trace.evidence.mode}
                  {result.trace.evidence.sourceRef ? <span className="block font-mono text-[10px] text-muted-foreground">{result.trace.evidence.sourceRef}</span> : null}
                  {result.trace.evidence.note ? <span className="mt-1 block text-muted-foreground">{result.trace.evidence.note}</span> : null}
                  {result.trace.evidence.error ? <span className="mt-1 block text-conflict">Error: {result.trace.evidence.error}</span> : null}
                </p>
                {result.answer.lessonsApplied.length > 0 ? (
                  <div className="mt-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-insight">Lessons applied</p>
                    <ul className="mt-1.5 space-y-1">
                      {result.answer.lessonsApplied.map((l, i) => (
                        <li key={i} className="text-xs leading-relaxed">· {l}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">
                    No lessons applied{result.trace.lessonsAvailable.length > 0 ? " — none were relevant to this question." : " (no SUPPORTED/APPLIED lessons exist yet)."}
                  </p>
                )}
              </CardContent>
            </Card>

            {result.trace.recalled.some((m) => m.sourceType === "LOCAL_MIRROR") ? (
              <p className="rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-xs text-muted-foreground">
                Some recalled memories are local mirrors (pending Walrus sync) — their content is available locally but not
                yet certified on-chain. The trace above labels every record's true source.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <SaveDecisionDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        question={question}
        answer={result?.answer ?? null}
        onSaved={() => {
          toast({ title: "Decision saved", description: "A decision summary was written through the memory policy." });
          setSaveOpen(false);
        }}
      />
    </div>
  );
}

function SaveDecisionDialog({
  open,
  onOpenChange,
  question,
  answer,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  question: string;
  answer: AskAnswer | null;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("OTHER");
  const [constraints, setConstraints] = useState("");
  const [assumptions, setAssumptions] = useState("");
  const [expected, setExpected] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!answer) return;
    setSaving(true);
    try {
      const j = await apiFetch<Record<string, unknown>>("/api/decisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category,
          title: title || question.slice(0, 80),
          question,
          goal: answer.recommendation.slice(0, 400),
          constraints: constraints.split("\n").map((s) => s.trim()).filter(Boolean),
          assumptions: assumptions.split("\n").map((s) => s.trim()).filter(Boolean).map((text, i) => ({ id: `a${i + 1}`, text })),
          evidenceRefs: [],
          recommendation: answer.recommendation,
          confidence: answer.uncertainty.level === "low" ? "medium" : answer.uncertainty.level === "high" ? "low" : "medium",
          expectedOutcome: expected || "To be defined before evaluation.",
          evaluationCriteria: "Set explicit criteria before the review date.",
        }),
      });
      onSaved();
    } catch (e) {
      alert(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto scrollbar-thin">
        <DialogHeader>
          <DialogTitle>Save as decision</DialogTitle>
          <DialogDescription>
            The decision record stores the reasoning, not just the answer — assumptions you list here will each get a
            verdict when you evaluate the outcome later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="d-title">Title</Label>
            <Input id="d-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={question.slice(0, 60)} />
          </div>
          <div>
            <Label htmlFor="d-cat">Category</Label>
            <select
              id="d-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {["INVESTMENT", "DEV_TOOLING", "SECURITY", "LIFESTYLE", "RESEARCH", "OTHER"].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="d-constraints">Constraints (one per line)</Label>
            <Textarea id="d-constraints" value={constraints} onChange={(e) => setConstraints(e.target.value)} rows={2} placeholder="e.g. max 5% per experimental position" />
          </div>
          <div>
            <Label htmlFor="d-assumptions">Assumptions (one per line)</Label>
            <Textarea id="d-assumptions" value={assumptions} onChange={(e) => setAssumptions(e.target.value)} rows={3} placeholder="e.g. liquidity will hold above $250k for a week" />
          </div>
          <div>
            <Label htmlFor="d-expected">Expected outcome</Label>
            <Textarea id="d-expected" value={expected} onChange={(e) => setExpected(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save decision"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
