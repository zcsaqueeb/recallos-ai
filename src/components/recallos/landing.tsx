"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useWorkspace } from "@/lib/store";
import { ThemeToggle } from "./theme-toggle";
import { ConnectWalletButton } from "./wallet";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, BrainCircuit, CheckCircle2, Dna, Eye, Layers, Loader2, RefreshCw, ShieldCheck } from "lucide-react";

const PILLARS = [
  {
    icon: Dna,
    title: "Decision DNA",
    body: "Store the reasoning, assumptions, evidence, constraints, and expected outcome behind every important decision — not just the answer.",
  },
  {
    icon: Layers,
    title: "ChainLens",
    body: "Pull real, current blockchain observations through Tatum's Sui gateway — and keep observed facts strictly separated from interpretation.",
  },
  {
    icon: RefreshCw,
    title: "Learning Loop",
    body: "Compare original assumptions with actual outcomes, derive evidence-backed lessons, and let verified lessons change future recommendations.",
  },
  {
    icon: Eye,
    title: "Visible proof",
    body: "Every recommendation shows which memories influenced it, which lessons applied, and what evidence would change it. Nothing to take on faith.",
  },
];

const LOOP = ["Observe", "Remember", "Recommend", "Verify", "Learn", "Apply"];

/** Staged captions for the enter transition — matched to what actually happens
 *  while the workspace warms up (status prefetch → view mount). */
const ENTER_STEPS = ["Restoring memory graph", "Connecting Tatum Sui gateway", "Preparing workspace"];

export function Landing() {
  const enter = useWorkspace((s) => s.enter);
  const reducedMotion = useReducedMotion();
  const [entering, setEntering] = useState(false);
  const [step, setStep] = useState(0);

  // While the overlay is up: lock scroll and advance the staged captions.
  useEffect(() => {
    if (!entering) return;
    document.body.style.overflow = "hidden";
    const iv = setInterval(() => setStep((s) => Math.min(s + 1, ENTER_STEPS.length - 1)), 430);
    return () => {
      clearInterval(iv);
      document.body.style.overflow = "";
    };
  }, [entering]);

  const handleEnter = () => {
    if (entering) return;
    setEntering(true);
    setStep(0);
    // Minimum splash time so the transition reads as intentional, capped wait
    // on the real /api/status prefetch so a slow network can't trap the user.
    const minDelay = new Promise((r) => setTimeout(r, reducedMotion ? 250 : 1300));
    const statusReady = fetch("/api/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    Promise.all([minDelay, Promise.race([statusReady, new Promise((r) => setTimeout(r, 2500))])]).then(() => {
      useWorkspace.getState().enter();
    });
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Floating wallet connect + theme switch — visible before entering the workspace */}
      <div className="fixed right-5 top-5 z-50 flex items-center gap-2">
        <ConnectWalletButton />
        <ThemeToggle />
      </div>
      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto max-w-5xl px-6 pt-24 pb-16 text-center">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <Badge variant="outline" className="mb-6 gap-2 border-insight/40 bg-insight/10 text-insight">
              <BrainCircuit className="h-3.5 w-3.5" /> Total Recall Hackathon — Walrus Memory × Tatum
            </Badge>
            <h1 className="text-4xl sm:text-6xl font-semibold tracking-tight leading-[1.05]">
              RECALLOS
            </h1>
            <p className="mt-5 text-xl sm:text-2xl text-muted-foreground font-light">
              Your AI doesn&apos;t just remember your past. <span className="text-gradient font-normal">It learns from it.</span>
            </p>
            <p className="mx-auto mt-6 max-w-2xl text-sm sm:text-base text-muted-foreground leading-relaxed">
              A personal decision agent with portable long-term memory. It remembers <em>why</em> you decided, checks
              new evidence on-chain, evaluates your past assumptions against real outcomes, and turns the lessons into
              better future recommendations — with the full memory-to-behavior path visible.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" onClick={handleEnter} disabled={entering} className="gap-2 h-12 px-7 text-base">
                {entering ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Entering…
                  </>
                ) : (
                  <>
                    Enter the workspace <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
              <Button size="lg" variant="outline" onClick={() => useWorkspace.getState().setView("learning")} className="h-12 px-7 text-base">
                See the learning loop
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Core principle: memory must change behavior — and the change must be explainable.
            </p>
          </motion.div>
        </section>

        {/* Learning loop strip */}
        <section className="mx-auto max-w-5xl px-6 pb-16">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.25, duration: 0.6 }}
            className="card-surface px-6 py-5"
          >
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm">
              {LOOP.map((step, i) => (
                <span key={step} className="flex items-center gap-3">
                  <span className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full border border-insight/40 bg-insight/10 text-[11px] font-semibold text-insight">
                      {i + 1}
                    </span>
                    <span className="font-medium">{step}</span>
                  </span>
                  {i < LOOP.length - 1 ? <span className="text-muted-foreground">→</span> : <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />}
                </span>
              ))}
            </div>
          </motion.div>
        </section>

        {/* Pillars */}
        <section className="mx-auto max-w-5xl px-6 pb-24">
          <div className="grid-cols-1 grid gap-4 sm:grid-cols-2">
            {PILLARS.map((p, i) => (
              <motion.div
                key={p.title}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.08, duration: 0.45 }}
              >
                <Card className="h-full border-border/70 bg-card/60">
                  <CardContent className="p-6">
                    <p.icon className="h-5 w-5 text-insight" />
                    <h3 className="mt-3 font-semibold tracking-tight">{p.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          <div className="mt-10 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-verified" />
            Honest by construction: verified Walrus writes are shown as verified; everything else is labeled local or pending — never presented as verified.
          </div>
        </section>
      </main>
      <footer className="mt-auto border-t py-6 text-center text-xs text-muted-foreground">
        RECALLOS · persistent-memory decision agent · Walrus Memory × Tatum × Sui
      </footer>

      {/* Enter transition: covers the landing page while the workspace warms up.
          The backdrop eases to fully opaque so the handoff to the workspace view
          (which mounts with its own fade-in) reads as a deliberate page change. */}
      <AnimatePresence>
        {entering ? (
          <motion.div
            key="enter-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0.1 : 0.25 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-background/85 backdrop-blur-xl"
            role="status"
            aria-live="polite"
            aria-label="Entering the workspace"
          >
            <motion.span
              aria-hidden
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: reducedMotion ? 0 : 0.85, duration: 0.5 }}
              className="absolute inset-0 bg-background"
            />
            <div className="relative flex w-full max-w-xs flex-col items-center px-6 text-center">
              {/* Spinner: rotating ring + breathing halo + core mark */}
              <div className="relative flex h-16 w-16 items-center justify-center">
                <motion.span
                  aria-hidden
                  className="absolute inset-0 rounded-full border-2 border-insight/25 border-t-insight"
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, ease: "linear", duration: 0.9 }}
                />
                <motion.span
                  aria-hidden
                  className="absolute inset-1.5 rounded-full border border-insight/20"
                  animate={reducedMotion ? undefined : { scale: [1, 1.1, 1], opacity: [0.45, 1, 0.45] }}
                  transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }}
                />
                <BrainCircuit className="h-6 w-6 text-insight" />
              </div>
              <p className="mt-5 text-sm font-medium">Entering the workspace</p>
              <p className="mt-1 text-xs text-muted-foreground">Memory, decisions and live chain data — restored.</p>
              <ul className="mt-5 w-full space-y-2 text-left">
                {ENTER_STEPS.map((label, i) => (
                  <li
                    key={label}
                    className={`flex items-center gap-2 text-xs transition-colors duration-300 ${i <= step ? "text-foreground" : "text-muted-foreground/50"}`}
                  >
                    {i < step ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-verified" />
                    ) : i === step ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-insight" />
                    ) : (
                      <span aria-hidden className="h-3.5 w-3.5 shrink-0 rounded-full border border-border" />
                    )}
                    {label}
                  </li>
                ))}
              </ul>
              <div aria-hidden className="mt-6 h-1 w-full overflow-hidden rounded-full bg-secondary">
                <motion.div
                  className="h-full rounded-full bg-insight"
                  initial={{ width: "4%" }}
                  animate={{ width: "100%" }}
                  transition={{ duration: reducedMotion ? 0.2 : 1.25, ease: "easeInOut" }}
                />
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
