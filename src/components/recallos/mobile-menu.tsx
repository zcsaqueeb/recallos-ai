"use client";

/**
 * Mobile menu — Task 25.
 *
 * Replaces the horizontally-scrolling pill strip on <lg screens with a
 * full-height slide-in navigation drawer, the pattern Android users expect:
 *  - spring-physics slide-in from the right with a blurred backdrop;
 *  - staggered row reveal (framer-motion) for a premium open sequence;
 *  - generous 44px+ touch targets with `active:` press feedback (hover states
 *    don't exist on touch);
 *  - safe-area padding for notched/gesture-nav devices (viewport-fit=cover
 *    is set in layout.tsx);
 *  - closes on selection, backdrop tap, Escape; locks body scroll while open;
 *  - carries everything the desktop header shows: navigation, wallet connect,
 *    integration status, and the theme switch (so the header row on phones
 *    can stay a single compact line).
 *
 * Rendering notes (both matter):
 *  - The drawer is rendered as a SIBLING of the sticky <header>, not inside
 *    it: the header's `backdrop-blur-md` (like any filter) makes it the
 *    containing block for fixed descendants, which collapses `inset-y-0`
 *    to the header's height.
 *  - No React portal for the animated content: AnimatePresence + portals
 *    silently skipped mounting; sibling placement is deterministic.
 *  - State lives in <Nav> so the hamburger (in the header) and the drawer
 *    (outside it) stay in sync.
 */

import { useCallback, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BrainCircuit,
  ChevronRight,
  Database,
  GraduationCap,
  LayoutDashboard,
  MessageCircleQuestion,
  NotebookPen,
  Settings,
  Telescope,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useWorkspace, type View } from "@/lib/store";
import type { StatusPayload } from "./nav";
import { ThemeToggle } from "./theme-toggle";
import { ConnectWalletButton } from "./wallet";
import { cn } from "@/lib/utils";

export const NAV_ITEMS: Array<{ view: View; label: string; icon: LucideIcon }> = [
  { view: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { view: "ask", label: "Ask", icon: MessageCircleQuestion },
  { view: "journal", label: "Journal", icon: NotebookPen },
  { view: "memory", label: "Memory", icon: Database },
  { view: "chainlens", label: "ChainLens", icon: Telescope },
  { view: "learning", label: "Learning Lab", icon: GraduationCap },
  { view: "settings", label: "Settings", icon: Settings },
];

const panel = {
  hidden: { x: "100%" },
  show: {
    x: 0,
    transition: { type: "spring" as const, stiffness: 380, damping: 40, mass: 0.9 },
  },
  exit: {
    x: "100%",
    transition: { type: "spring" as const, stiffness: 460, damping: 46, mass: 0.9 },
  },
};

const backdrop = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.22 } },
  exit: { opacity: 0, transition: { duration: 0.22, delay: 0.04 } },
};

const rows = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.09 } },
};

const row = {
  hidden: { opacity: 0, x: 26 },
  show: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const },
  },
};

/* ------------------------------ hamburger button --------------------------- */

export function MobileMenuButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={open ? "Close menu" : "Open menu"}
      aria-expanded={open}
      aria-haspopup="dialog"
      className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/70 bg-secondary/60 text-muted-foreground transition-colors active:bg-secondary active:text-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 lg:hidden"
    >
      {/* Menu ⇄ X morph */}
      <span className="relative flex h-4 w-4 items-center justify-center">
        <motion.span
          className="absolute"
          initial={false}
          animate={open ? { rotate: 90, scale: 0, opacity: 0 } : { rotate: 0, scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 26 }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </motion.span>
        <motion.span
          className="absolute"
          initial={false}
          animate={open ? { rotate: 0, scale: 1, opacity: 1 } : { rotate: -90, scale: 0, opacity: 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 26 }}
        >
          <X className="h-4 w-4" />
        </motion.span>
      </span>
    </button>
  );
}

/* --------------------------------- drawer ---------------------------------- */

export function MobileMenuDrawer({
  open,
  onClose,
  status,
  onGoSettings,
}: {
  open: boolean;
  onClose: () => void;
  status: StatusPayload | null;
  onGoSettings: () => void;
}) {
  const { view, setView } = useWorkspace();

  const close = useCallback(() => onClose(), [onClose]);

  /* Body scroll lock while the drawer is open. */
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  /* Escape closes. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const go = (v: View) => {
    setView(v);
    close();
  };

  const goSettings = () => {
    onGoSettings();
    close();
  };

  const walrusOk = Boolean(status?.integrations.walrus.configured);
  const tatumOk = Boolean(status?.integrations.tatum.configured);

  return (
    <AnimatePresence>
      {open ? (
        <div className="lg:hidden" data-testid="mobile-menu">
          <motion.div
            key="backdrop"
            variants={backdrop}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={close}
            className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-sm"
            aria-hidden
          />
          <motion.aside
            key="panel"
            variants={panel}
            initial="hidden"
            animate="show"
            exit="exit"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className="fixed inset-y-0 right-0 z-[61] flex w-84 max-w-[88vw] flex-col border-l border-border/70 bg-background/95 backdrop-blur-xl shadow-2xl shadow-black/30"
          >
            {/* brand row */}
            <motion.div
              variants={rows}
              initial="hidden"
              animate="show"
              className="flex items-center justify-between border-b border-border/60 px-5 pb-3.5 pt-[max(0.9rem,env(safe-area-inset-top))]"
            >
              <motion.span variants={row} className="flex items-center gap-2 font-semibold tracking-tight">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-insight/15 text-insight">
                  <BrainCircuit className="h-4 w-4" />
                </span>
                RECALLOS
              </motion.span>
              <motion.button
                variants={row}
                type="button"
                onClick={close}
                aria-label="Close menu"
                className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-secondary hover:bg-secondary hover:text-foreground"
              >
                <X className="h-4.5 w-4.5" />
              </motion.button>
            </motion.div>

            <motion.nav
              variants={rows}
              initial="hidden"
              animate="show"
              aria-label="Mobile"
              className="flex-1 overflow-y-auto scrollbar-thin px-3 pb-2 pt-3"
            >
              <motion.p variants={row} className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
                Navigate
              </motion.p>
              {NAV_ITEMS.map((item) => {
                const active = view === item.view;
                return (
                  <motion.button
                    key={item.view}
                    variants={row}
                    type="button"
                    onClick={() => go(item.view)}
                    aria-current={active ? "page" : undefined}
                    whileTap={{ scale: 0.975 }}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-[15px] transition-colors active:bg-secondary",
                      active
                        ? "bg-secondary font-medium text-foreground"
                        : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-lg transition-colors",
                        active ? "bg-insight/15 text-insight" : "bg-muted/50 text-muted-foreground",
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                    </span>
                    {item.label}
                    <ChevronRight
                      className={cn("ml-auto h-4 w-4 transition-opacity", active ? "text-insight" : "opacity-0")}
                    />
                  </motion.button>
                );
              })}

              <motion.p variants={row} className="px-2 pb-1.5 pt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
                Integrations
              </motion.p>
              <motion.button
                variants={row}
                type="button"
                onClick={goSettings}
                whileTap={{ scale: 0.975 }}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-[15px] text-muted-foreground transition-colors active:bg-secondary hover:bg-secondary/60 hover:text-foreground"
              >
                <span className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-muted/50">
                  <span className={cn("h-2 w-2 rounded-full", walrusOk ? "bg-verified" : "bg-muted-foreground")} />
                </span>
                Walrus Memory
                <span className={cn("text-xs", walrusOk ? "text-verified" : "text-muted-foreground/70")}>
                  {walrusOk ? "on" : "off"}
                </span>
                <ChevronRight className="ml-auto h-4 w-4 opacity-40" />
              </motion.button>
              <motion.button
                variants={row}
                type="button"
                onClick={goSettings}
                whileTap={{ scale: 0.975 }}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-[15px] text-muted-foreground transition-colors active:bg-secondary hover:bg-secondary/60 hover:text-foreground"
              >
                <span className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-muted/50">
                  <span className={cn("h-2 w-2 rounded-full", tatumOk ? "bg-verified" : "bg-muted-foreground")} />
                </span>
                Tatum · Sui gateway
                <span className={cn("text-xs", tatumOk ? "text-verified" : "text-muted-foreground/70")}>
                  {tatumOk ? "on" : "off"}
                </span>
                <ChevronRight className="ml-auto h-4 w-4 opacity-40" />
              </motion.button>

              <motion.p variants={row} className="px-2 pb-1.5 pt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
                Wallet &amp; appearance
              </motion.p>
              <motion.div variants={row} className="px-1 pb-1">
                <ConnectWalletButton alwaysLabeled />
              </motion.div>
              <motion.div variants={row} className="flex min-h-11 items-center justify-between rounded-xl px-3">
                <span className="text-[15px] text-muted-foreground">Theme</span>
                <ThemeToggle />
              </motion.div>
            </motion.nav>

            <motion.div
              variants={row}
              initial="hidden"
              animate="show"
              className="border-t border-border/60 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-center text-[11px] text-muted-foreground/70"
            >
              memory that changes behavior, visibly
            </motion.div>
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
