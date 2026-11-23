// SPDX-License-Identifier: AGPL-3.0-only
// Multi-material fork: shared types for the multi-material panel, the engine
// protocol and the viewport layer.

/** Options sent to the engine (`Model::mm_run`). */
export interface MmOptions {
  materials: {
    name: string;
    e: number;
    nu: number;
    density: number;
    stressAllow?: number;
    strainAllow?: number;
  }[];
  wCompliance: number;
  wRisk: number;
  riskExponent: number;
  /** Per material: upper bound on its volume fraction, null = none. */
  maxFraction: (number | null)[];
  keepMaterial: number;
  filterRadius: number;
  maxIter: number;
  /** Also start from every single material and keep the best design. */
  multiStart: boolean;
  /** Solid cells of this run's own grid. */
  cells: number;
}

export interface MmProgress {
  iteration: number;
  penalty: number;
  objective: number;
  compliance: number;
  risk: number;
  meanChange: number;
}

/** One candidate design (an optimizer start or a single-material design). */
export interface MmCandidate {
  label: string;
  objective: number;
  feasible: boolean;
  compliance: number;
  maxDisp: number;
  riskMax: number;
  riskP: number;
  failing: number;
  volumeFractions: number[];
}

export interface MmSummary {
  iterations: number;
  converged: boolean;
  grayFraction: number;
  compliance: number;
  maxDisp: number;
  riskMax: number;
  riskP: number;
  failing: number;
  volumeFractions: number[];
  massG: number;
  baselines: MmCandidate[];
  /** Label of the design that was chosen, and every candidate considered. */
  chosen: string;
  candidates: MmCandidate[];
  materials: string[];
  budgetUsage: [number, number][];
  seconds: number;
}

/** Surface mesh of one material's region. */
export interface MmRegion {
  material: number;
  positions: Float32Array;
  indices: Uint32Array;
}

export interface MmOutput {
  summary: MmSummary;
  regions: MmRegion[];
}

/** Viewport colors of the materials of a mix, by position in the mix. */
export const MM_PALETTE = ["#d9822b", "#3b7dd8", "#2fa36b", "#c04ba0", "#8a8f98", "#d6c21f"];
export const mmColor = (i: number) => MM_PALETTE[i % MM_PALETTE.length];

/** Multi-material settings — part of the app's settings: kept per browser and
 *  saved in the project. The materials themselves are the app's material
 *  library (Settings / Material manager); this only says WHICH of them take
 *  part and how to weigh the objectives. */
export interface MmSettings {
  /** Derived: true as soon as at least one additional material is added
   *  (switches the Optimize step). */
  enabled: boolean;
  /** Names of the ADDITIONAL library materials. The first material of the mix
   *  is always the part's material chosen in the Properties step. */
  names: string[];
  /** Per material name: upper bound on its volume share in %, "" = none. */
  maxPercent: Record<string, string>;
  /** Weight of deformation (stiffness) in the objective. */
  wCompliance: number;
  /** Weight of cracking risk in the objective. */
  wRisk: number;
  riskExponent: number;
  /** Name of the material kept at supports and load patches. */
  keepName: string;
  /** Solid cells of the multi-material run's own coarse grid. */
  cells: number;
  maxIter: number;
  filterRadius: number;
  multiStart: boolean;
}

export const defaultMmSettings = (): MmSettings => ({
  enabled: false,
  names: [],
  maxPercent: {},
  wCompliance: 1,
  wRisk: 1,
  riskExponent: 8,
  keepName: "",
  cells: 3000,
  maxIter: 120,
  filterRadius: 1.5,
  multiStart: false,
});

/** Merge a stored/partial object into valid settings (unknown keys dropped). */
export function sanitizeMm(raw: unknown): MmSettings {
  const d = defaultMmSettings();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<MmSettings>;
  const n = (v: unknown, lo: number, hi: number, dflt: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
  const names = Array.isArray(r.names) ? r.names.filter((x): x is string => typeof x === "string") : [];
  return {
    enabled: names.length > 0,
    names,
    maxPercent:
      r.maxPercent && typeof r.maxPercent === "object"
        ? Object.fromEntries(Object.entries(r.maxPercent).filter(([, v]) => typeof v === "string")) as Record<string, string>
        : {},
    wCompliance: n(r.wCompliance, 0, 1000, d.wCompliance),
    wRisk: n(r.wRisk, 0, 1000, d.wRisk),
    riskExponent: n(r.riskExponent, 2, 20, d.riskExponent),
    keepName: typeof r.keepName === "string" ? r.keepName : "",
    cells: n(r.cells, 500, 60000, d.cells),
    maxIter: n(r.maxIter, 5, 1000, d.maxIter),
    filterRadius: n(r.filterRadius, 1, 4, d.filterRadius),
    multiStart: r.multiStart === true,
  };
}
