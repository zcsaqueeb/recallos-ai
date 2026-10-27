"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api-client";
import { EmptyBlock, ErrorBlock, LoadingBlock, SectionHeader, SourceBadge } from "./shared";
import { Loader2, Plus, Search, ShieldCheck } from "lucide-react";

type WalrusEvidenceLite = {
  blobId: string;
  transport: string;
  aggregatorUrl: string;
  explorerUrl: string;
  suiObjectUrl?: string;
  ownerAccount?: string;
  namespace?: string;
  epochs?: { start: number; end: number } | null;
  certifiedAt: string;
};

type Memory = {
  id: string;
  category: string;
  content: string;
  sourceType: string;
  storageState: string;
  externalId: string | null;
  importance: number;
  tags: string[];
  createdAt: string;
  evidence?: WalrusEvidenceLite | null;
  score?: number;
  conflictWith?: string[];
};

const CATEGORIES = ["PREFERENCE", "GOAL", "DECISION_SUMMARY", "LESSON", "EVIDENCE_PATTERN", "CONSTRAINT", "CORRECTION"];

export function MemoryExplorer() {
  const { toast } = useToast();
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [writeOpen, setWriteOpen] = useState(false);
  const [mode, setMode] = useState<"browse" | "recall">("browse");

  const load = useCallback(() => {
    const url = query.trim() && mode === "recall" ? `/api/memories?q=${encodeURIComponent(query)}` : "/api/memories";
    apiFetch<{ memories: Memory[] }>(url)
      .then((j) => setMemories(j.memories))
      .catch((e: Error) => setError(e.message));
  }, [query, mode]);

  useEffect(() => {
    load();
  }, [load]);

  const shown = (memories ?? []).filter((m) => (category === "all" ? true : m.category === category));

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Memory Explorer"
        title="What RECALLOS remembers — and where it came from"
        sub="Every record shows its true source: Walrus-verified writes, local mirrors pending sync, or direct user input. Use Recall mode to see scoring and conflict detection in action."
        right={
          <Button size="sm" onClick={() => setWriteOpen(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Write memory
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-64 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value) setMode("recall");
            }}
            placeholder="Search or recall (ranked by relevance)…"
            className="pl-9"
            aria-label="Search memories"
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-52" aria-label="Filter by category">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>{c.replaceAll("_", " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {mode === "recall" ? (
          <Button variant="ghost" size="sm" onClick={() => { setMode("browse"); setQuery(""); }}>
            Back to browse
          </Button>
        ) : null}
      </div>

      {mode === "recall" && query ? (
        <p className="text-xs text-muted-foreground">
          Recall mode: results ranked by keyword/category relevance. Conflicts are flagged, never silently resolved.
        </p>
      ) : null}

      {memories === null && !error ? <LoadingBlock label="Loading memories…" /> : null}
      {error ? <ErrorBlock title="Failed to load memories" detail={error} /> : null}
      {memories !== null && shown.length === 0 ? (
        <EmptyBlock
          title={mode === "recall" ? "Nothing matched that recall" : "No memories yet"}
          hint={mode === "recall" ? "Try different wording." : "Memories are created by decisions, outcome evaluations, lessons, and direct writes."}
          action={!query ? <Button size="sm" variant="outline" onClick={() => setWriteOpen(true)}>Write the first memory</Button> : undefined}
        />
      ) : null}

      <div className="grid-cols-1 grid gap-3 md:grid-cols-2">
        {shown.map((m) => (
          <Card key={m.id} className="border-border/70 bg-card/60">
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <SourceBadge sourceType={m.sourceType} storageState={m.storageState} />
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{m.category.replaceAll("_", " ")}</span>
                {m.importance >= 4 ? <span className="text-[10px] text-insight">importance {m.importance}/5</span> : null}
                {typeof m.score === "number" && mode === "recall" ? (
                  <span className="ml-auto text-[10px] text-muted-foreground">relevance {m.score.toFixed(1)}</span>
                ) : null}
              </div>
              <p className="mt-2 text-sm leading-relaxed">{m.content}</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {m.tags.map((t) => (
                  <span key={t} className="rounded-full bg-secondary/60 px-2 py-0.5 text-[10px] text-muted-foreground">#{t}</span>
                ))}
                <span className="ml-auto text-[10px] text-muted-foreground">{new Date(m.createdAt).toLocaleString()}</span>
              </div>
              {m.externalId && m.storageState === "VERIFIED" ? (
                <EvidenceBar evidence={m.evidence} fallbackId={m.externalId} />
              ) : m.externalId ? (
                <p className="mt-2 flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                  <ShieldCheck className="h-3 w-3" /> walrus ref {m.externalId.slice(0, 18)}… (pending on-chain confirmation)
                </p>
              ) : null}
              {m.conflictWith && m.conflictWith.length > 0 ? (
                <p className="mt-2 text-[11px] text-conflict">Conflicts with {m.conflictWith.length} other memory(ies).</p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <WriteMemoryDialog
        open={writeOpen}
        onOpenChange={setWriteOpen}
        onSaved={() => {
          load();
          toast({ title: "Memory written", description: "Stored through the write policy — verified only if Walrus confirms." });
        }}
      />
    </div>
  );
}

/** Verifiable-proof strip for a VERIFIED memory: copy blob id + raw bytes + on-chain certification. */
function EvidenceBar({ evidence, fallbackId }: { evidence?: WalrusEvidenceLite | null; fallbackId: string }) {
  const { toast } = useToast();
  const blobId = evidence?.blobId ?? fallbackId;
  const aggregatorUrl = evidence?.aggregatorUrl ?? `https://aggregator.walrus-mainnet.walrus.space/v1/blobs/${blobId}`;
  const explorerUrl = evidence?.explorerUrl ?? `https://walruscan.com/mainnet/blob/${blobId}`;
  const epochs = evidence?.epochs ? `${evidence.epochs.end - evidence.epochs.start} epochs` : null;
  return (
    <div className="mt-2.5 rounded-md border border-verified/25 bg-verified/5 px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-verified" />
        <span className="text-[11px] font-medium text-verified">Walrus mainnet · certified</span>
        <span className="font-mono text-[10px] text-muted-foreground" title={blobId}>{blobId.slice(0, 12)}…{blobId.slice(-6)}</span>
        <button
          className="rounded px-1 py-1 text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => {
            navigator.clipboard?.writeText(blobId);
            toast({ title: "Blob id copied" });
          }}
        >
          copy
        </button>
        <span className="ml-auto flex items-center gap-2">
          <a href={aggregatorUrl} target="_blank" rel="noreferrer" className="rounded px-1 py-1 text-[10px] font-medium text-verified underline-offset-2 hover:underline">
            Read blob ↗
          </a>
          <a href={explorerUrl} target="_blank" rel="noreferrer" className="rounded px-1 py-1 text-[10px] font-medium text-verified underline-offset-2 hover:underline">
            On-chain proof ↗
          </a>
        </span>
      </div>
      {evidence ? (
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          Transport {evidence.transport === "memwal-sdk" ? "MemWal relayer" : "direct upload"}
          {evidence.namespace ? ` · namespace ${evidence.namespace}` : ""}
          {epochs ? ` · stored ${epochs}` : ""} · certified {new Date(evidence.certifiedAt).toLocaleString()}
          {evidence.suiObjectUrl ? (
            <>
              {" · "}
              <a href={evidence.suiObjectUrl} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">blob object on Sui ↗</a>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

function WriteMemoryDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [category, setCategory] = useState("PREFERENCE");
  const [content, setContent] = useState("");
  const [importance, setImportance] = useState("3");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{
    sourceType: string;
    storageState: string;
    walrusError: string | null;
    evidence?: WalrusEvidenceLite | null;
  } | null>(null);

  const save = async () => {
    setSaving(true);
    setResult(null);
    try {
      const j = await apiFetch<{
        sourceType: string;
        storageState: string;
        walrusError: string | null;
        evidence?: WalrusEvidenceLite | null;
      }>("/api/memories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category,
          content,
          importance: Number(importance),
          tags: tags.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      setResult(j);
      onSaved();
    } catch (e) {
      toast({ title: "Write failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setResult(null); setContent(""); } }}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto scrollbar-thin">
        <DialogHeader>
          <DialogTitle>Write a memory</DialogTitle>
          <DialogDescription>
            Goes through the write policy: deduplicated locally, then pushed to Walrus Memory. The record is only
            reported verified if the real integration confirms the write.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-3 text-sm">
            <p className="rounded-lg border border-border/60 bg-background/40 p-3 text-xs leading-relaxed">
              Stored as <strong>{result.sourceType}</strong> / <strong>{result.storageState}</strong>.
              {result.walrusError ? (
                <span className="mt-1 block text-conflict">Walrus did not confirm the write ({result.walrusError}) — honestly reported as pending, not verified.</span>
              ) : result.storageState === "VERIFIED" ? (
                <span className="mt-1 block text-verified">Confirmed by the real Walrus Memory integration.</span>
              ) : (
                <span className="mt-1 block text-muted-foreground">Kept as a durable local mirror; it will sync once Walrus credentials are configured.</span>
              )}
            </p>
            {result.storageState === "VERIFIED" && result.evidence ? (
              <div className="rounded-lg border border-verified/30 bg-verified/5 p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-verified">
                  <ShieldCheck className="h-3.5 w-3.5" /> Certified on Walrus mainnet — verify it yourself:
                </p>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground" title={result.evidence.blobId}>
                  blob {result.evidence.blobId.slice(0, 20)}…{result.evidence.blobId.slice(-8)}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="h-7 gap-1 border-verified/40 text-verified hover:bg-verified/10" asChild>
                    <a href={result.evidence.aggregatorUrl} target="_blank" rel="noreferrer">Read blob from aggregator ↗</a>
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 gap-1 border-verified/40 text-verified hover:bg-verified/10" asChild>
                    <a href={result.evidence.explorerUrl} target="_blank" rel="noreferrer">On-chain proof ↗</a>
                  </Button>
                </div>
                <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                  The aggregator link returns the exact stored bytes; the explorer link shows the blob certification on Sui.
                  {result.evidence.transport === "memwal-sdk" ? " Stored encrypted through the MemWal relayer — ciphertext is expected." : ""}
                </p>
              </div>
            ) : null}
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div>
                <Label>Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.replaceAll("_", " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="m-content">Content</Label>
                <Textarea id="m-content" value={content} onChange={(e) => setContent(e.target.value)} rows={3} placeholder="A durable fact, preference, or constraint worth remembering…" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="m-importance">Importance (1–5)</Label>
                  <Input id="m-importance" type="number" min={1} max={5} value={importance} onChange={(e) => setImportance(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="m-tags">Tags (comma-separated)</Label>
                  <Input id="m-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="risk, custody" />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={save} disabled={saving || content.trim().length < 4} className="gap-1.5">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Write memory
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
