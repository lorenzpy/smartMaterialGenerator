// SPDX-License-Identifier: AGPL-3.0-only
// Multi-material fork: shared types for the multi-material panel, the engine
// protocol and the viewport layer.

/** One material of the part. Units: MPa, g/cm³, strain dimensionless. */
export interface MmMaterial {
  name: string;
  e: number;
  nu: number;
  density: number;
  /** Allowable von Mises stress (MPa); blank/0 = no limit. */
  stressAllow: number;
  /** Allowable strain; blank/0 = no limit. */
  strainAllow: number;
  /** Viewport color, "#rrggbb". */
  color: string;
}

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

/** Default material library (TEST VALUES, not measured data). */
export const MM_PRESETS: MmMaterial[] = [
  { name: "PLA", e: 3500, nu: 0.35, density: 1.24, stressAllow: 50, strainAllow: 0.025, color: "#d9822b" },
  { name: "ASA", e: 2400, nu: 0.37, density: 1.07, stressAllow: 43, strainAllow: 0.04, color: "#3b7dd8" },
  { name: "TPU", e: 80, nu: 0.45, density: 1.21, stressAllow: 30, strainAllow: 0.2, color: "#2fa36b" },
];

export const MM_PALETTE = ["#d9822b", "#3b7dd8", "#2fa36b", "#c04ba0", "#8a8f98", "#d6c21f"];
