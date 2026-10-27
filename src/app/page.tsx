"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useWorkspace } from "@/lib/store";
import { Nav, type StatusPayload } from "@/components/recallos/nav";
import { Landing } from "@/components/recallos/landing";
import { Dashboard } from "@/components/recallos/dashboard";
import { Ask } from "@/components/recallos/ask";
import { Journal } from "@/components/recallos/journal";
import { MemoryExplorer } from "@/components/recallos/memory-explorer";
import { ChainLens } from "@/components/recallos/chainlens";
import { LearningLab } from "@/components/recallos/learning-lab";
import { Settings } from "@/components/recallos/settings";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-client";

export default function Page() {
  const view = useWorkspace((s) => s.view);
  const setView = useWorkspace((s) => s.setView);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const loadStatus = () => {
    apiFetch<StatusPayload>("/api/status")
      .then((data: StatusPayload) => {
        setStatus(data);
        setStatusError(null);
      })
      .catch((err: Error) => setStatusError(err.message));
  };

  useEffect(() => {
    loadStatus();
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <Nav status={status} onGoSettings={() => setView("settings")} />

      <main className="flex-1">
        {view === "landing" ? (
          <Landing />
        ) : (
          // Gentle mount fade — this element mounts exactly when the enter
          // overlay finishes, so the splash-to-workspace handoff stays smooth.
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="mx-auto max-w-6xl px-4 py-8 sm:px-6"
          >
            {statusError ? (
              <div className="card-surface p-6 text-sm">
                <p className="font-medium">Could not load workspace status.</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">{statusError}</p>
                <Button variant="outline" size="sm" className="mt-4" onClick={loadStatus}>
                  Retry
                </Button>
              </div>
            ) : !status ? (
              <div className="grid gap-3">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-40 w-full rounded-xl" />
                <Skeleton className="h-40 w-full rounded-xl" />
              </div>
            ) : (
              <>
                {view === "dashboard" && <Dashboard status={status} onRefresh={loadStatus} />}
                {view === "ask" && <Ask status={status} />}
                {view === "journal" && <Journal />}
                {view === "memory" && <MemoryExplorer />}
                {view === "chainlens" && <ChainLens status={status} onGoSettings={() => setView("settings")} />}
                {view === "learning" && <LearningLab status={status} />}
                {view === "settings" && <Settings status={status} onRefresh={loadStatus} />}
              </>
            )}
          </motion.div>
        )}
      </main>

      {view !== "landing" ? (
        <footer className="mt-auto border-t py-5 text-center text-xs text-muted-foreground">
          RECALLOS · memory that changes behavior, visibly · <button className="underline underline-offset-2 hover:text-foreground" onClick={() => setView("settings")}>integration status</button>
        </footer>
      ) : null}
    </div>
  );
}
