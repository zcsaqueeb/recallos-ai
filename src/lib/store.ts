"use client";

import { create } from "zustand";

export type View =
  | "landing"
  | "dashboard"
  | "ask"
  | "journal"
  | "memory"
  | "chainlens"
  | "learning"
  | "settings";

type WorkspaceState = {
  view: View;
  entered: boolean;
  setView: (v: View) => void;
  enter: () => void;
};

export const useWorkspace = create<WorkspaceState>((set) => ({
  view: "landing",
  entered: false,
  setView: (view) => set({ view, entered: view !== "landing" ? true : false }),
  enter: () => set({ view: "dashboard", entered: true }),
}));
