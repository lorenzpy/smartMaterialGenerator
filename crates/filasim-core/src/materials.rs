// SPDX-License-Identifier: AGPL-3.0-only
//
// Multi-material fork, milestone M1: per-cell material map.
// New file in the fork (not part of upstream filaSim).

//! Per-cell material assignment for multi-material parts (fork milestone M1).
//!
//! The solver keeps ONE reference element matrix scaled per cell by `eps`
//! (see [`crate::eps`]). This module supplies the heterogeneity on top of that
//! unchanged mechanism: each cell carries a material id, and
//! `eps = occupancy_factor × E_material / E_reference`.
//!
//! Scope of M1 (deliberately small):
//! - stiffness ratio per cell, mass and volume share per material;
//! - Any number of isotropic materials with any Poisson ratios, realized
//!   through the solver's existing second-tensor ("TI overlay") path: two
//!   isotropic reference tensors span all of them ([`LameBasis`], exact for
//!   linear elasticity, no change to `mg.rs`);
//! - no strength, interface or cost data yet.
//!
//! The map lives NEXT TO [`VoxelGrid`] rather than inside it, so none of the
//! many `VoxelGrid { .. }` literals (tests, benches, padding) change. It must
//! be built on the PADDED grid the solver actually uses (see
//! [`crate::solve::pad_for_levels`]).

use crate::eps::{EpsField, EMIN_REL};
use crate::solve::SolveSettings;
use crate::ti::isotropic_ratios;
use crate::voxel::VoxelGrid;

/// Constants of one material. Units: MPa, g/cm³.
#[derive(Clone, Debug, PartialEq)]
pub struct MaterialProps {
    pub name: String,
    /// Young's modulus (MPa).
    pub e: f64,
    /// Poisson ratio (used per cell via [`MaterialMap::solver_inputs`]).
    pub nu: f64,
    /// Density (g/cm³), used for mass and mass fractions.
    pub density: f64,
    /// Allowable von Mises stress (MPa); `INFINITY` = not specified.
    pub stress_allow: f64,
    /// Allowable (stress-equivalent) strain; `INFINITY` = not specified.
    pub strain_allow: f64,
}

impl MaterialProps {
    pub fn new(name: &str, e: f64, nu: f64, density: f64) -> Self {
        Self {
            name: name.to_string(),
            e,
            nu,
            density,
            stress_allow: f64::INFINITY,
            strain_allow: f64::INFINITY,
        }
    }

    /// Set the failure limits (stress in MPa, strain dimensionless).
    pub fn with_limits(mut self, stress_allow: f64, strain_allow: f64) -> Self {
        self.stress_allow = stress_allow;
        self.strain_allow = strain_allow;
        self
    }

    /// Effective allowable stress: under linear elasticity a strain limit is
    /// the stress limit `E·ε_allow`, so the binding limit is the smaller one.
    /// This is what lets a brittle stiff material (low strain limit, high E)
    /// and a ductile soft one (high strain limit, low E) share ONE failure
    /// index `σ_vm / σ_eff`. `INFINITY` when neither limit is set.
    pub fn sigma_eff(&self) -> f64 {
        self.stress_allow.min(self.e * self.strain_allow)
    }

    // ---- TEST VALUES ----------------------------------------------------
    // Placeholders for development only. NOT measured, NOT datasheet values.
    // Replace with real data before drawing any engineering conclusion.

    /// Test value: PLA (matches the upstream default preset).
    pub fn test_pla() -> Self {
        Self::new("PLA (test)", 3500.0, 0.35, 1.24).with_limits(50.0, 0.025)
    }
    /// Test value: ASA (matches the upstream default preset).
    pub fn test_asa() -> Self {
        Self::new("ASA (test)", 2400.0, 0.37, 1.07).with_limits(43.0, 0.04)
    }
    /// Test value: a soft TPU. E and nu are placeholders.
    pub fn test_tpu() -> Self {
        Self::new("TPU (test)", 80.0, 0.45, 1.21).with_limits(30.0, 0.20)
    }
}

/// Per-cell material ids plus the material table they index.
#[derive(Clone, Debug)]
pub struct MaterialMap {
    /// Material id per cell, same indexing as `VoxelGrid::scale`.
    pub id: Vec<u8>,
    pub table: Vec<MaterialProps>,
    /// Index of the reference material: the solver's `SolveSettings::e0`
    /// MUST equal `table[reference].e` for `eps` to mean what it says.
    pub reference: usize,
}

/// Why a map is not usable with a grid.
#[derive(Debug, PartialEq, Eq)]
pub enum MaterialError {
    EmptyTable,
    BadReference,
    LengthMismatch { cells: usize, ids: usize },
    UnknownId(u8),
    NonPositiveModulus(usize),
}

impl MaterialMap {
    /// Every cell gets material `fill`; `reference` is the reference index.
    pub fn uniform(grid: &VoxelGrid, table: Vec<MaterialProps>, reference: usize, fill: u8) -> Self {
        Self { id: vec![fill; grid.cell_count()], table, reference }
    }

    /// Check the map against a grid and its own table.
    pub fn validate(&self, grid: &VoxelGrid) -> Result<(), MaterialError> {
        if self.table.is_empty() {
            return Err(MaterialError::EmptyTable);
        }
        if self.reference >= self.table.len() {
            return Err(MaterialError::BadReference);
        }
        if self.id.len() != grid.cell_count() {
            return Err(MaterialError::LengthMismatch { cells: grid.cell_count(), ids: self.id.len() });
        }
        for (i, m) in self.table.iter().enumerate() {
            if !(m.e > 0.0) {
                return Err(MaterialError::NonPositiveModulus(i));
            }
        }
        if let Some(&bad) = self.id.iter().find(|&&v| v as usize >= self.table.len()) {
            return Err(MaterialError::UnknownId(bad));
        }
        Ok(())
    }

    /// Reference modulus (MPa): put this into `SolveSettings::e0`.
    pub fn e_ref(&self) -> f64 {
        self.table[self.reference].e
    }

    /// World coordinates of a cell center.
    #[inline]
    fn center(grid: &VoxelGrid, cx: usize, cy: usize, cz: usize) -> [f64; 3] {
        [
            grid.origin[0] + (cx as f64 + 0.5) * grid.h,
            grid.origin[1] + (cy as f64 + 0.5) * grid.h,
            grid.origin[2] + (cz as f64 + 0.5) * grid.h,
        ]
    }

    /// Assign `mat` to every cell whose center lies in the axis-aligned box
    /// `[min, max]` (world mm, inclusive). Void cells are assigned too; they
    /// stay void because `eps`/mass multiply the occupancy.
    pub fn assign_box(&mut self, grid: &VoxelGrid, min: [f64; 3], max: [f64; 3], mat: u8) {
        for cz in 0..grid.nz {
            for cy in 0..grid.ny {
                for cx in 0..grid.nx {
                    let p = Self::center(grid, cx, cy, cz);
                    if (0..3).all(|d| p[d] >= min[d] && p[d] <= max[d]) {
                        self.id[grid.cell_index(cx, cy, cz)] = mat;
                    }
                }
            }
        }
    }

    /// Assign `mat` where `n·p ≤ c` (world mm) — a half-space through the part.
    pub fn assign_halfspace(&mut self, grid: &VoxelGrid, n: [f64; 3], c: f64, mat: u8) {
        for cz in 0..grid.nz {
            for cy in 0..grid.ny {
                for cx in 0..grid.nx {
                    let p = Self::center(grid, cx, cy, cz);
                    if n[0] * p[0] + n[1] * p[1] + n[2] * p[2] <= c {
                        self.id[grid.cell_index(cx, cy, cz)] = mat;
                    }
                }
            }
        }
    }

    /// Per-cell stiffness factors for a solid (non-graded) multi-material part.
    ///
    /// `eps = (EMIN_REL + (1-EMIN_REL)·occupancy) · E_mat / E_ref`, void cells
    /// stay exactly 0. With a single material (`E_mat == E_ref`) this is
    /// bit-identical to [`crate::eps::grid_eps`] — the property that keeps the
    /// original code path reproducible (tested).
    ///
    /// Panics if the map does not validate against `grid`.
    pub fn eps(&self, grid: &VoxelGrid) -> Vec<f32> {
        self.validate(grid).expect("MaterialMap does not match the grid");
        let e_ref = self.e_ref();
        let ratio: Vec<f64> = self.table.iter().map(|m| m.e / e_ref).collect();
        let mut eps = vec![0f32; grid.cell_count()];
        for (i, &sc) in grid.scale.iter().enumerate() {
            if sc > 0.0 {
                let base = EMIN_REL + (1.0 - EMIN_REL) * sc;
                let r = ratio[self.id[i] as usize];
                // r == 1.0 keeps the exact grid_eps value (no extra rounding).
                eps[i] = if r == 1.0 { base } else { (base as f64 * r) as f32 };
            }
        }
        eps
    }

    /// Occupancy-weighted solid volume per material (mm³), indexed like `table`.
    pub fn volumes(&self, grid: &VoxelGrid) -> Vec<f64> {
        self.validate(grid).expect("MaterialMap does not match the grid");
        let cell_vol = grid.h * grid.h * grid.h;
        let mut v = vec![0f64; self.table.len()];
        for (i, &sc) in grid.scale.iter().enumerate() {
            if sc > 0.0 {
                v[self.id[i] as usize] += sc as f64 * cell_vol;
            }
        }
        v
    }

    /// Mass per material (g): volume × density (mm³ → cm³ is ×1e-3).
    pub fn masses_g(&self, grid: &VoxelGrid) -> Vec<f64> {
        self.volumes(grid)
            .iter()
            .zip(&self.table)
            .map(|(v, m)| v * 1e-3 * m.density)
            .collect()
    }

    /// Mass share per material (sums to 1, or all zeros for an empty grid).
    pub fn mass_fractions(&self, grid: &VoxelGrid) -> Vec<f64> {
        let m = self.masses_g(grid);
        let total: f64 = m.iter().sum();
        if total > 0.0 {
            m.iter().map(|x| x / total).collect()
        } else {
            vec![0.0; m.len()]
        }
    }

    /// Volume share per material (sums to 1, or all zeros for an empty grid).
    pub fn volume_fractions(&self, grid: &VoxelGrid) -> Vec<f64> {
        let v = self.volumes(grid);
        let total: f64 = v.iter().sum();
        if total > 0.0 {
            v.iter().map(|x| x / total).collect()
        } else {
            vec![0.0; v.len()]
        }
    }
}

/// Lamé parameters `(λ, μ)` of an isotropic material.
pub fn lame(e: f64, nu: f64) -> (f64, f64) {
    (e * nu / ((1.0 + nu) * (1.0 - 2.0 * nu)), e / (2.0 * (1.0 + nu)))
}

/// Two reference tensors that span ANY number of isotropic materials.
///
/// For an isotropic material `K_e = λ·K_vol + μ·K_dev` (the element matrix is
/// linear in the stiffness tensor, which is linear in `(λ, μ)`). Pick two
/// isotropic reference tensors `A` (ν_lo) and `B` (ν_hi) at the same `e0`;
/// every `(λ, μ)` whose ratio `μ/λ` lies between theirs is a NON-NEGATIVE
/// combination `w_a·A + w_b·B`. That covers every isotropic material with
/// `ν ∈ [ν_lo, ν_hi]` AND every Voigt mixture of such materials (mixing adds
/// `(λ, μ)` linearly) — with the solver's existing two-tensor path and no
/// change to `mg.rs`.
#[derive(Clone, Copy, Debug)]
pub struct LameBasis {
    pub e0: f64,
    pub nu_lo: f64,
    pub nu_hi: f64,
    a: (f64, f64),
    b: (f64, f64),
}

impl LameBasis {
    pub fn new(e0: f64, nu_lo: f64, nu_hi: f64) -> Self {
        Self { e0, nu_lo, nu_hi, a: lame(e0, nu_lo), b: lame(e0, nu_hi) }
    }

    /// One reference tensor suffices (all materials share one ν).
    pub fn is_degenerate(&self) -> bool {
        (self.nu_hi - self.nu_lo).abs() <= 1e-9
    }

    /// Weights `(w_a, w_b)` with `w_a·A + w_b·B = (λ, μ)`; tiny negative
    /// rounding residue is clamped to 0. Degenerate basis: `(μ/μ_a, 0)`.
    pub fn weights(&self, lambda: f64, mu: f64) -> (f64, f64) {
        if self.is_degenerate() {
            return (mu / self.a.1, 0.0);
        }
        let det = self.a.0 * self.b.1 - self.b.0 * self.a.1;
        let wa = (lambda * self.b.1 - self.b.0 * mu) / det;
        let wb = (self.a.0 * mu - lambda * self.a.1) / det;
        (wa.max(0.0), wb.max(0.0))
    }

    /// Solver settings matching this basis: primary tensor at `ν_lo`, the
    /// overlay (second tensor) at `ν_hi` when the basis is not degenerate.
    pub fn settings(&self, base: SolveSettings) -> SolveSettings {
        let mut s = base;
        s.e0 = self.e0;
        s.nu = self.nu_lo;
        s.ti = if self.is_degenerate() { None } else { Some(isotropic_ratios(self.nu_hi)) };
        s
    }
}

impl MaterialMap {
    /// Everything the solver needs for this map: the per-cell stiffness field
    /// and the matching [`SolveSettings`].
    ///
    /// Any number of isotropic materials with any Poisson ratios is
    /// supported through [`LameBasis`]: the basis spans the smallest and the
    /// largest ν among the materials actually used. All used materials share
    /// one ν → plain single-tensor path (`ti = None`). `e0` is the reference
    /// material's modulus; `base` supplies tolerance / iteration limits.
    pub fn solver_inputs(
        &self,
        grid: &VoxelGrid,
        base: SolveSettings,
    ) -> Result<(EpsField, SolveSettings), MaterialError> {
        self.validate(grid)?;
        let e_ref = self.e_ref();
        let (mut nu_lo, mut nu_hi) = (f64::INFINITY, f64::NEG_INFINITY);
        let mut used = vec![false; self.table.len()];
        for (i, &sc) in grid.scale.iter().enumerate() {
            if sc > 0.0 {
                used[self.id[i] as usize] = true;
            }
        }
        for (m, &u) in self.table.iter().zip(&used) {
            if u {
                nu_lo = nu_lo.min(m.nu);
                nu_hi = nu_hi.max(m.nu);
            }
        }
        if !nu_lo.is_finite() {
            // No solid cell: keep the reference material, nothing to solve.
            nu_lo = self.table[self.reference].nu;
            nu_hi = nu_lo;
        }
        let basis = LameBasis::new(e_ref, nu_lo, nu_hi);
        let settings = basis.settings(base);
        if basis.is_degenerate() {
            return Ok((EpsField::from(self.eps(grid)), settings));
        }
        let n = grid.cell_count();
        let lam_mu: Vec<(f64, f64)> = self.table.iter().map(|m| lame(m.e, m.nu)).collect();
        let (mut wa, mut wb) = (vec![0f32; n], vec![0f32; n]);
        for (i, &sc) in grid.scale.iter().enumerate() {
            if sc > 0.0 {
                let f = (EMIN_REL + (1.0 - EMIN_REL) * sc) as f64;
                let (l, m) = lam_mu[self.id[i] as usize];
                let (a, b) = basis.weights(f * l, f * m);
                wa[i] = a as f32;
                wb[i] = b as f32;
            }
        }
        Ok((EpsField::ti(wa, wb), settings))
    }
}
