"use client";

import { useState } from "react";
import { useWorkspace } from "@/lib/store";
import { IntegrationChip } from "./shared";
import { ThemeToggle } from "./theme-toggle";
import { ConnectWalletButton } from "./wallet";
import { MobileMenuButton, MobileMenuDrawer, NAV_ITEMS } from "./mobile-menu";
import { cn } from "@/lib/utils";
import { BrainCircuit } from "lucide-react";

export type StatusPayload = {
  workspace: { id: string; displayName: string };
  integrations: {
    walrus: { configured: boolean; transport: string | null; live: boolean; network: string; sdkInstalled: boolean; missingEnv: string[]; namespace: string | null; source: string | null; envFallbackAvailable: boolean; customSaved: boolean; note: string };
    tatum: { configured: boolean; network: string; networkEnvSet: boolean; gatewayUrl: string | null; source: string | null; customSaved: boolean; envFallbackAvailable: boolean; note: string };
    ai: { configured: boolean; note: string };
  };
  counters: {
    memoryTotal: number;
    memoryVerified: number;
    memoryMirror: number;
    decisions: number;
    decisionsEvaluated: number;
    lessons: number;
    lessonsApplied: number;
    lastObservationAt: string | null;
    lastObservationKind: string | null;
  };
};

export function Nav({
  status,
  onGoSettings,
}: {
  status: StatusPayload | null;
  onGoSettings: () => void;
}) {
  const { view, setView, entered } = useWorkspace();
  // Menu state lives here: the hamburger sits inside the header, the drawer
  // must render OUTSIDE it (the header's backdrop-filter would otherwise
  // become the containing block for the fixed drawer and collapse it).
  const [menuOpen, setMenuOpen] = useState(false);
  if (!entered || view === "landing") return null;

  const walrusOk = Boolean(status?.integrations.walrus.configured);
  const tatumOk = Boolean(status?.integrations.tatum.configured);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:px-6 sm:py-2.5">
        <button onClick={() => setView("dashboard")} className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-insight/15 text-insight">
            <BrainCircuit className="h-4 w-4" />
          </span>
          RECALLOS
        </button>

        {/* Desktop navigation — below lg the MobileMenu drawer takes over. */}
        <nav aria-label="Primary" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.view}>
                <button
                  onClick={() => setView(item.view)}
                  aria-current={view === item.view ? "page" : undefined}
                  className={cn(
                    "whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] transition-colors",
                    view === item.view
                      ? "bg-secondary font-medium text-foreground"
                      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                  )}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <ConnectWalletButton />
          <ThemeToggle />
          <span className="hidden items-center gap-1.5 lg:flex">
            <IntegrationChip name="Walrus" configured={walrusOk} onClick={onGoSettings} />
            <IntegrationChip name="Tatum" configured={tatumOk} onClick={onGoSettings} />
          </span>
          <MobileMenuButton open={menuOpen} onToggle={() => setMenuOpen((v) => !v)} />
        </div>
      </div>
      </header>

      <MobileMenuDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        status={status}
        onGoSettings={onGoSettings}
      />
    </>
  );
}
