// SPDX-License-Identifier: AGPL-3.0-only
// Multi-material fork: state and actions of the multi-material panel.

import { create } from "zustand";
import { engine } from "../engine/EngineClient";
import { sceneEvents, useStore } from "../store";
import { MM_PALETTE, MM_PRESETS, type MmMaterial, type MmProgress, type MmSummary } from "./types";

interface MmState {
  open: boolean;
  materials: MmMaterial[];
  /** Objective weights (stiffness / deformation vs. failure risk). */
  wCompliance: number;
  wRisk: number;
  /** Per material: max volume fraction in %, "" = unbounded. */
  maxPercent: string[];
  keepMaterial: number;
  /** Analysis resolution (solid cells). Small keeps the optimizer interactive. */
  cells: number;
  maxIter: number;
  filterRadius: number;
  riskExponent: number;
  multiStart: boolean;
  running: boolean;
  progress: MmProgress | null;
  history: MmProgress[];
  summary: MmSummary | null;
  error: string | null;
  setOpen: (open: boolean) => void;
  update: (patch: Partial<MmState>) => void;
  setMaterial: (i: number, patch: Partial<MmMaterial>) => void;
  addMaterial: () => void;
  removeMaterial: (i: number) => void;
  run: () => Promise<void>;
  clear: () => void;
}

export const useMm = create<MmState>((set, get) => ({
  open: false,
  materials: MM_PRESETS.map((m) => ({ ...m })),
  wCompliance: 1,
  wRisk: 1,
  maxPercent: MM_PRESETS.map(() => ""),
  keepMaterial: 0,
  cells: 6000,
  maxIter: 120,
  filterRadius: 1.5,
  riskExponent: 8,
  multiStart: false,
  running: false,
  progress: null,
  history: [],
  summary: null,
  error: null,
  setOpen: (open) => set({ open }),
  update: (patch) => set(patch as Partial<MmState>),
  setMaterial: (i, patch) =>
    set((s) => ({ materials: s.materials.map((m, k) => (k === i ? { ...m, ...patch } : m)) })),
  addMaterial: () =>
    set((s) => ({
      materials: [
        ...s.materials,
        {
          name: `Material ${s.materials.length + 1}`,
          e: 2000,
          nu: 0.36,
          density: 1.2,
          stressAllow: 40,
          strainAllow: 0.03,
          color: MM_PALETTE[s.materials.length % MM_PALETTE.length],
        },
      ],
      maxPercent: [...s.maxPercent, ""],
    })),
  removeMaterial: (i) =>
    set((s) =>
      s.materials.length <= 2
        ? s
        : {
            materials: s.materials.filter((_, k) => k !== i),
            maxPercent: s.maxPercent.filter((_, k) => k !== i),
            keepMaterial: Math.min(s.keepMaterial, s.materials.length - 2),
          }
    ),
  clear: () => {
    sceneEvents.onMultiMaterial?.(null);
    set({ summary: null, progress: null, history: [], error: null });
  },
  run: async () => {
    const s = get();
    if (s.running) return;
    if (!useStore.getState().model) {
      set({ error: "Load a model first (the sample part is loaded on startup)." });
      return;
    }
    set({ running: true, error: null, progress: null, history: [], summary: null });
    try {
      await engine.setResolution(s.cells);
      const out = await engine.mmRun(
        {
          materials: s.materials.map((m) => ({
            name: m.name,
            e: m.e,
            nu: m.nu,
            density: m.density,
            stressAllow: m.stressAllow > 0 ? m.stressAllow : undefined,
            strainAllow: m.strainAllow > 0 ? m.strainAllow : undefined,
          })),
          wCompliance: s.wCompliance,
          wRisk: s.wRisk,
          riskExponent: s.riskExponent,
          maxFraction: s.maxPercent.map((v) => (v.trim() === "" ? null : Math.max(0, Math.min(100, Number(v))) / 100)),
          keepMaterial: s.keepMaterial,
          filterRadius: s.filterRadius,
          maxIter: s.maxIter,
          multiStart: s.multiStart,
        },
        (p) => set((st) => ({ progress: p, history: [...st.history, p] }))
      );
      sceneEvents.onMultiMaterial?.(
        out.regions.map((r) => ({
          color: get().materials[r.material]?.color ?? "#888888",
          positions: r.positions,
          indices: r.indices,
        }))
      );
      set({ summary: out.summary });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ running: false });
    }
  },
}));
