"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

type ViewTransitionDocument = Document & {
  startViewTransition?: (updateCallback: () => void) => { ready: Promise<void> };
};

/**
 * Dark/light switch with a best-in-class View Transitions reveal:
 *  - the new theme expands as a circle from the exact click point (Chrome/Edge/
 *    Android Chrome), while the old theme recedes (slight zoom-out + dim) so
 *    the sweep reads as depth, not just a wipe;
 *  - keyboard activation gets the button center as the origin;
 *  - Firefox/Safari fall back to a soft cross-fade via the .theme-anim utility;
 *  - prefers-reduced-motion switches instantly;
 *  - the icon is a spring sun/moon morph and the button itself presses in.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  const handleToggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!mounted) return;
    const next = isDark ? "light" : "dark";
    const doc = document as ViewTransitionDocument;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // No View Transitions support (or reduced motion): instant or cross-fade.
    if (!doc.startViewTransition || reduceMotion) {
      if (!reduceMotion) {
        const root = document.documentElement;
        root.classList.add("theme-anim");
        window.setTimeout(() => root.classList.remove("theme-anim"), 500);
      }
      setTheme(next);
      return;
    }

    // Origin: the real click point; keyboard activation (detail === 0) falls
    // back to the button's center so the reveal still radiates from the switch.
    const rect = event.currentTarget.getBoundingClientRect();
    const keyboard = event.detail === 0;
    const x = keyboard ? rect.left + rect.width / 2 : event.clientX;
    const y = keyboard ? rect.top + rect.height / 2 : event.clientY;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    const transition = doc.startViewTransition(() => setTheme(next));
    transition.ready.then(() => {
      const easing = "cubic-bezier(0.4, 0, 0.2, 1)";
      // The new theme sweeps out of the click point…
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${endRadius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 640,
          easing,
          pseudoElement: "::view-transition-new(root)",
        }
      );
      // …while the old theme recedes behind it — a subtle zoom + dim gives the
      // sweep depth instead of a flat crossfade.
      document.documentElement.animate(
        {
          transform: ["scale(1)", "scale(0.98)"],
          opacity: [1, 0.85],
        },
        {
          duration: 640,
          easing,
          pseudoElement: "::view-transition-old(root)",
        }
      );
    });
  };

  return (
    <motion.button
      type="button"
      onClick={handleToggle}
      whileTap={{ scale: 0.86 }}
      whileHover={{ scale: 1.06 }}
      transition={{ type: "spring", stiffness: 420, damping: 22 }}
      aria-label={mounted ? `Switch to ${isDark ? "light" : "dark"} theme` : "Toggle theme"}
      className={cn(
        "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/70 bg-secondary/60 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        className
      )}
    >
      <span className="relative flex h-4 w-4 items-center justify-center">
        {/* Sun — visible in dark mode (offers the light side) */}
        <motion.span
          className="absolute flex"
          initial={false}
          animate={
            mounted && isDark
              ? { rotate: 0, scale: 1, opacity: 1 }
              : { rotate: 90, scale: 0, opacity: 0 }
          }
          transition={{ type: "spring", stiffness: 320, damping: 24 }}
        >
          <Sun className="h-4 w-4" />
        </motion.span>
        {/* Moon — visible in light mode (offers the dark side) */}
        <motion.span
          className="absolute flex"
          initial={false}
          animate={
            mounted && isDark
              ? { rotate: -90, scale: 0, opacity: 0 }
              : { rotate: 0, scale: 1, opacity: 1 }
          }
          transition={{ type: "spring", stiffness: 320, damping: 24 }}
        >
          <Moon className="h-4 w-4" />
        </motion.span>
      </span>
    </motion.button>
  );
}
