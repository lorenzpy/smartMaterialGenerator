// SPDX-License-Identifier: AGPL-3.0-only
//
// Multi-material fork, milestone M4: two-material compliance optimization.
// New file in the fork (not part of upstream filaSim).

//! Two-material (stiff / soft) compliance minimization under a mass and/or
//! stiff-material-fraction budget.
//!
//! Every solid cell is filled with one of two materials (no void, the outer
//! shape is fixed). Design variable `ρ ∈ [ρ_min, 1]` per cell is the stiff
//! material share:
//!
//! ```text
//!   K_e(ρ) = ρ^p · occ · K_stiff  +  (1 − ρ^p) · occ · (E_soft/E_ref) · K_soft
//! ```
//!
//! — SIMP-style penalization between the two materials (monotone in ρ, unlike
//! the symmetric `ρ^p + (1-ρ)^p` weighting). It maps exactly onto the solver's
//! existing two-tensor path (`EpsField::ti` + isotropic overlay), so the two
//! materials may have different Poisson ratios and `mg.rs` is untouched.
//!
//! Budget. Mass and stiff volume are both LINEAR in `Σ scale_i · ρ_i` with the
//! same coefficient for every cell, so any combination of
//! `max_stiff_volume_fraction` and `max_mass_g` collapses to ONE bound on that
//! sum; a single Lagrange multiplier (bisection) enforces it. This relies on
//! `density_stiff > density_soft` (then a mass cap is an upper bound on the
//! stiff share); the opposite order is rejected.
//!
//! Method. Density filter (cone weights) on ρ and on sensitivities, optimality
//! criteria update with move limit, penalty continuation `p0 → p1`, then
//! ranking-based binarization to the exact budget and an independent
//! verification solve through [`MaterialMap::solver_inputs`] (a different code
//! path than the one the optimizer iterates on).
//!
//! Scope: one load case, linear elasticity, compliance objective. Strength
//! enters only as an optional keep-stiff prior (`keep_stiff_above_stress`),
//! not as an optimization constraint.

use crate::eps::{EpsField, EMIN_REL};
use crate::fem::{ke_hex, NODE_OFFSETS};
use crate::materials::MaterialMap;
use crate::solve::{solve_cached, NodeProblem, SolveSettings, SolverCache};
use crate::ti::isotropic_ratios;
use crate::voxel::VoxelGrid;

const RHO_MIN: f64 = 1e-3;

/// Evaluation context: everything that stays fixed across iterations,
/// including the cached multigrid hierarchy.
pub struct MmContext<'a> {
    grid: &'a VoxelGrid,
    levels: usize,
    problem: &'a NodeProblem,
    settings: SolveSettings,
    ke_s: [[f64; 24]; 24],
    ke_t: [[f64; 24]; 24],
    /// `E_soft / E_ref` (the stiff material is the reference).
    r_t: f64,
    /// Occupancy factor with the solver's `EMIN_REL` floor; 0 for void.
    occ: Vec<f64>,
    slot: Option<SolverCache>,
    /// Displacement of the last [`eval`](Self::eval).
    pub last_u: Vec<f64>,
}

impl<'a> MmContext<'a> {
    /// `stiff` must be `start.reference` (the solver's `e0`/`nu`).
    pub fn new(
        grid: &'a VoxelGrid,
        levels: usize,
        problem: &'a NodeProblem,
        start: &MaterialMap,
        stiff: u8,
        soft: u8,
        base: SolveSettings,
    ) -> Result<Self, String> {
        start.validate(grid).map_err(|e| format!("{e:?}"))?;
        if stiff as usize != start.reference {
            return Err("the stiff material must be the map's reference material".into());
        }
        if stiff == soft {
            return Err("stiff and soft must differ".into());
        }
        let ms = &start.table[stiff as usize];
        let mt = &start.table[soft as usize];
        let mut settings = base;
        settings.e0 = ms.e;
        settings.nu = ms.nu;
        // Always use the overlay for the soft class (also when the Poisson
        // ratios coincide): one code path, constant hierarchy.
        settings.ti = Some(isotropic_ratios(mt.nu));
        let occ = grid
            .scale
            .iter()
            .map(|&s| if s > 0.0 { EMIN_REL as f64 + (1.0 - EMIN_REL as f64) * s as f64 } else { 0.0 })
            .collect();
        Ok(Self {
            grid,
            levels,
            problem,
            settings,
            ke_s: ke_hex(ms.e, ms.nu, grid.h),
            ke_t: ke_hex(ms.e, mt.nu, grid.h),
            r_t: mt.e / ms.e,
            occ,
            slot: None,
            last_u: Vec::new(),
        })
    }

    pub fn settings(&self) -> &SolveSettings {
        &self.settings
    }

    /// Compliance and `dC/dρ` for a per-grid-cell stiff share `rho` (void
    /// cells ignored) at penalty `p`. Sensitivities are w.r.t. the PHYSICAL
    /// (already filtered) `rho`; 0 for void cells.
    pub fn eval(&mut self, rho: &[f64], p: f64) -> Result<(f64, Vec<f64>), String> {
        let g = self.grid;
        let n = g.cell_count();
        assert_eq!(rho.len(), n);
        let (mut ws, mut wt) = (vec![0f32; n], vec![0f32; n]);
        for i in 0..n {
            let o = self.occ[i];
            if o > 0.0 {
                let a = rho[i].clamp(RHO_MIN, 1.0).powf(p);
                ws[i] = (o * a) as f32;
                wt[i] = (o * (1.0 - a) * self.r_t) as f32;
            }
        }
        let r = solve_cached(
            &mut self.slot,
            g,
            self.levels,
            self.problem,
            &self.settings,
            EpsField::ti(ws, wt),
            self.settings.tol,
            self.settings.max_iter,
        )
        .map_err(|e| format!("{e}"))?;
        self.last_u = r.u;
        let u = &self.last_u;
        let (mx, my) = (g.nx + 1, g.ny + 1);
        let mut dc = vec![0f64; n];
        for ci in 0..n {
            if self.occ[ci] <= 0.0 {
                continue;
            }
            let (cx, cy, cz) = (ci % g.nx, (ci / g.nx) % g.ny, ci / (g.nx * g.ny));
            let mut ul = [0f64; 24];
            for l in 0..8 {
                let [ox, oy, oz] = NODE_OFFSETS[l];
                let nd = ((cz + oz) * my + (cy + oy)) * mx + (cx + ox);
                ul[3 * l..3 * l + 3].copy_from_slice(&u[3 * nd..3 * nd + 3]);
            }
            let (mut se_s, mut se_t) = (0f64, 0f64);
            for i in 0..24 {
                let (mut a, mut b) = (0f64, 0f64);
                for j in 0..24 {
                    a += self.ke_s[i][j] * ul[j];
                    b += self.ke_t[i][j] * ul[j];
                }
                se_s += ul[i] * a;
                se_t += ul[i] * b;
            }
            let rc = rho[ci].clamp(RHO_MIN, 1.0);
            dc[ci] = -self.occ[ci] * p * rc.powf(p - 1.0) * (se_s - self.r_t * se_t);
        }
        Ok((r.compliance, dc))
    }
}

/// Cone density filter over solid cells (row-normalized).
struct Filter {
    rows: Vec<Vec<(u32, f32)>>,
}

impl Filter {
    fn build(grid: &VoxelGrid, radius: f64) -> Self {
        let n = grid.cell_count();
        let mut rows = vec![Vec::new(); n];
        let rc = radius.ceil() as i64;
        for ci in 0..n {
            if grid.scale[ci] <= 0.0 {
                continue;
            }
            let (cx, cy, cz) = ((ci % grid.nx) as i64, ((ci / grid.nx) % grid.ny) as i64, (ci / (grid.nx * grid.ny)) as i64);
            let mut row = Vec::new();
            let mut sum = 0f64;
            for dz in -rc..=rc {
                for dy in -rc..=rc {
                    for dx in -rc..=rc {
                        let (x, y, z) = (cx + dx, cy + dy, cz + dz);
                        if x < 0 || y < 0 || z < 0 || x >= grid.nx as i64 || y >= grid.ny as i64 || z >= grid.nz as i64 {
                            continue;
                        }
                        let d = ((dx * dx + dy * dy + dz * dz) as f64).sqrt();
                        let w = (radius - d).max(0.0);
                        let cj = ((z as usize) * grid.ny + y as usize) * grid.nx + x as usize;
                        if w > 0.0 && grid.scale[cj] > 0.0 {
                            row.push((cj as u32, w));
                            sum += w;
                        }
                    }
                }
            }
            rows[ci] = row.into_iter().map(|(j, w)| (j, (w / sum) as f32)).collect();
        }
        Self { rows }
    }
    fn apply(&self, x: &[f64]) -> Vec<f64> {
        self.rows
            .iter()
            .map(|r| r.iter().map(|&(j, a)| a as f64 * x[j as usize]).sum())
            .collect()
    }
    fn apply_t(&self, g: &[f64]) -> Vec<f64> {
        let mut out = vec![0f64; g.len()];
        for (i, r) in self.rows.iter().enumerate() {
            for &(j, a) in r {
                out[j as usize] += a as f64 * g[i];
            }
        }
        out
    }
}

#[derive(Clone, Debug)]
pub struct MmConfig {
    /// Material ids; `stiff` must be the map's reference material.
    pub stiff: u8,
    pub soft: u8,
    /// Upper bound on the stiff share of the solid volume.
    pub max_stiff_volume_fraction: Option<f64>,
    /// Upper bound on the part mass (g). Requires `density_stiff > density_soft`.
    pub max_mass_g: Option<f64>,
    /// Cone filter radius in cells; `<= 1` disables filtering.
    pub filter_radius_cells: f64,
    pub penalty_start: f64,
    pub penalty_end: f64,
    pub penalty_step: f64,
    pub iters_per_penalty: usize,
    pub max_iter: usize,
    pub move_limit: f64,
    /// Convergence: max design change at the final penalty.
    pub tol_change: f64,
    /// Cells fixed to the stiff material (supports, load patches). Empty = none.
    pub frozen_stiff: Vec<bool>,
    /// Optional strength prior: cells whose stress in the ALL-STIFF design
    /// exceeds this value (MPa) are fixed stiff (the soft material would not
    /// carry that stress within its strain limit).
    pub keep_stiff_above_stress: Option<f64>,
    /// Stop on the MEAN design change instead of the max (default false =
    /// max, the original behavior).
    pub converge_on_mean: bool,
    /// Average consecutive designs `x ← ½(x_new + x)` from this iteration on
    /// (kills OC 2-cycles). `None` = off (original).
    pub damping_start: Option<usize>,
    /// Geometric move-limit decay after iteration 10, floor 25 % of the
    /// initial limit. Default false (original: constant limit).
    pub move_limit_decay: bool,
}

impl MmConfig {
    pub fn new(stiff: u8, soft: u8) -> Self {
        Self {
            stiff,
            soft,
            max_stiff_volume_fraction: None,
            max_mass_g: None,
            filter_radius_cells: 1.5,
            penalty_start: 1.0,
            penalty_end: 3.0,
            penalty_step: 0.5,
            iters_per_penalty: 12,
            max_iter: 150,
            move_limit: 0.2,
            tol_change: 0.01,
            frozen_stiff: Vec::new(),
            keep_stiff_above_stress: None,
            converge_on_mean: false,
            damping_start: None,
            move_limit_decay: false,
        }
    }
}

#[derive(Clone, Debug)]
pub struct MmIter {
    pub iteration: usize,
    pub penalty: f64,
    pub compliance: f64,
    /// Max |Δx| over design cells (the original stopping measure).
    pub change: f64,
    /// Mean |Δx| over design cells.
    pub mean_change: f64,
    /// Max |x_t − x_{t−2}|: small while `change` is large = a 2-cycle.
    pub two_cycle: f64,
    /// Cells with |Δx| > 0.05, and how many of those have a filtered ρ̃ in
    /// the gray band (0.1, 0.9).
    pub n_moving: usize,
    pub n_moving_gray: usize,
}

#[derive(Clone, Debug)]
pub struct MmResult {
    /// Filtered physical stiff share per grid cell at the end of the run.
    pub rho: Vec<f64>,
    /// Binarized design (exact budget) as a material map.
    pub map: MaterialMap,
    pub iterations: usize,
    pub converged: bool,
    pub history: Vec<MmIter>,
    /// The budget bound `Σ scale·ρ ≤ s_max` actually used (cell volumes).
    pub s_max: f64,
    /// Stiff volume fraction / mass of the binarized design.
    pub stiff_volume_fraction: f64,
    pub mass_g: f64,
    /// Compliance of the last (continuous) iterate.
    pub compliance_continuous: f64,
    /// Compliance of the binarized design, from an independent solve.
    pub compliance_binary: f64,
    /// Share of design cells with filtered ρ̃ in (0.1, 0.9) before binarization.
    pub gray_fraction: f64,
    /// Same share, but for the UNFILTERED design variable x (shows how much
    /// of the gray is only filter blur).
    pub gray_fraction_design: f64,
    /// Cells held stiff by `frozen_stiff` or the strength prior.
    pub frozen_cells: usize,
}

/// Run the optimization. `levels` and `grid` are the padded solver grid.
pub fn optimize_two_material(
    grid: &VoxelGrid,
    levels: usize,
    problem: &NodeProblem,
    start: &MaterialMap,
    cfg: &MmConfig,
    base: SolveSettings,
) -> Result<MmResult, String> {
    let n = grid.cell_count();
    let ms = start.table[cfg.stiff as usize].clone();
    let mt = start.table[cfg.soft as usize].clone();
    let mut ctx = MmContext::new(grid, levels, problem, start, cfg.stiff, cfg.soft, base)?;
    let solid: Vec<usize> = (0..n).filter(|&i| grid.scale[i] > 0.0).collect();
    if solid.is_empty() {
        return Err("no solid cells".into());
    }
    let total: f64 = solid.iter().map(|&i| grid.scale[i] as f64).sum();

    // ---- budget -> single bound on S = Σ scale·ρ ----
    let mut bounds: Vec<f64> = Vec::new();
    if let Some(f) = cfg.max_stiff_volume_fraction {
        bounds.push(f * total);
    }
    if let Some(m) = cfg.max_mass_g {
        if ms.density <= mt.density {
            return Err("a mass cap needs density(stiff) > density(soft)".into());
        }
        let cell = grid.h.powi(3) * 1e-3; // mm³ -> cm³
        bounds.push((m / cell - mt.density * total) / (ms.density - mt.density));
    }
    if bounds.is_empty() {
        return Err("give max_stiff_volume_fraction and/or max_mass_g".into());
    }
    let s_max = bounds.iter().cloned().fold(f64::INFINITY, f64::min).min(total);

    // ---- frozen set ----
    let mut frozen = if cfg.frozen_stiff.len() == n { cfg.frozen_stiff.clone() } else { vec![false; n] };
    if let Some(sig) = cfg.keep_stiff_above_stress {
        let mut all_stiff = start.clone();
        for &i in &solid {
            all_stiff.id[i] = cfg.stiff;
        }
        let (u, _) = ctx.eval(&vec![1.0; n], 1.0)?;
        let _ = u;
        let uf: Vec<f32> = ctx.last_u.iter().map(|&v| v as f32).collect();
        let f = crate::threshold::cell_fields(grid, &uf, &all_stiff);
        for &i in &solid {
            if (f.vm[i] as f64) > sig {
                frozen[i] = true;
            }
        }
    }
    for i in 0..n {
        if grid.scale[i] <= 0.0 {
            frozen[i] = false;
        }
    }
    let s_frozen: f64 = solid.iter().filter(|&&i| frozen[i]).map(|&i| grid.scale[i] as f64).sum();
    if s_frozen > s_max + 1e-9 {
        return Err(format!("frozen stiff volume {s_frozen:.1} exceeds the budget {s_max:.1}"));
    }
    let design: Vec<usize> = solid.iter().copied().filter(|&i| !frozen[i]).collect();
    let s_design: f64 = design.iter().map(|&i| grid.scale[i] as f64).sum();

    // ---- init ----
    let mut x = vec![0f64; n];
    for &i in &solid {
        x[i] = if frozen[i] { 1.0 } else { 0.0 };
    }
    let x0 = if s_design > 0.0 { ((s_max - s_frozen) / s_design).clamp(RHO_MIN, 1.0) } else { 1.0 };
    for &i in &design {
        x[i] = x0;
    }
    let filter = Filter::build(grid, cfg.filter_radius_cells);
    let vol = |rho_t: &[f64]| -> f64 { solid.iter().map(|&i| grid.scale[i] as f64 * rho_t[i]).sum() };

    let mut history = Vec::new();
    let mut converged = false;
    let mut iterations = 0;
    let mut compliance = f64::NAN;
    let n_steps = ((cfg.penalty_end - cfg.penalty_start) / cfg.penalty_step).round().max(0.0) as usize;
    let p_of = |it: usize| -> f64 {
        let k = (it / cfg.iters_per_penalty.max(1)).min(n_steps);
        cfg.penalty_start + k as f64 * cfg.penalty_step
    };
    let final_phase_start = n_steps * cfg.iters_per_penalty.max(1);
    let mut x_prev2 = x.clone();
    for it in 0..cfg.max_iter {
        iterations = it + 1;
        let p = p_of(it);
        let rho_t = filter.apply(&x);
        let (c, dc_t) = ctx.eval(&rho_t, p)?;
        compliance = c;
        let g = filter.apply_t(&dc_t);

        // OC update, bisection on the multiplier so Σ scale·ρ̃ = s_max.
        let ml = if cfg.move_limit_decay && it >= 10 {
            (cfg.move_limit * 0.92f64.powi(it as i32 - 9)).max(0.25 * cfg.move_limit)
        } else {
            cfg.move_limit
        };
        let (mut lo, mut hi) = (1e-30f64, 1e30f64);
        let mut x_new = x.clone();
        for _ in 0..100 {
            let lam = (lo * hi).sqrt();
            for &i in &design {
                let be = (-g[i]).max(0.0) / (lam * grid.scale[i] as f64);
                x_new[i] = (x[i] * be.sqrt())
                    .clamp(x[i] - ml, x[i] + ml)
                    .clamp(RHO_MIN, 1.0);
            }
            let v = vol(&filter.apply(&x_new));
            if v > s_max {
                lo = lam;
            } else {
                hi = lam;
            }
            if hi / lo < 1.0 + 1e-10 {
                break;
            }
        }
        if cfg.damping_start.is_some_and(|d| it >= d) {
            for &i in &design {
                x_new[i] = 0.5 * (x_new[i] + x[i]);
            }
        }
        let change = design.iter().map(|&i| (x_new[i] - x[i]).abs()).fold(0.0, f64::max);
        let mean_change = if design.is_empty() { 0.0 } else { design.iter().map(|&i| (x_new[i] - x[i]).abs()).sum::<f64>() / design.len() as f64 };
        let two_cycle = design.iter().map(|&i| (x_new[i] - x_prev2[i]).abs()).fold(0.0, f64::max);
        let moving: Vec<usize> = design.iter().copied().filter(|&i| (x_new[i] - x[i]).abs() > 0.05).collect();
        let n_moving_gray = moving.iter().filter(|&&i| rho_t[i] > 0.1 && rho_t[i] < 0.9).count();
        history.push(MmIter {
            iteration: it + 1,
            penalty: p,
            compliance: c,
            change,
            mean_change,
            two_cycle,
            n_moving: moving.len(),
            n_moving_gray,
        });
        x_prev2 = x;
        x = x_new;
        let measure = if cfg.converge_on_mean { mean_change } else { change };
        if it >= final_phase_start && measure < cfg.tol_change {
            converged = true;
            break;
        }
    }

    // ---- final physical field and binarization ----
    let rho = filter.apply(&x);
    let gray = if design.is_empty() {
        0.0
    } else {
        design.iter().filter(|&&i| rho[i] > 0.1 && rho[i] < 0.9).count() as f64 / design.len() as f64
    };
    let gray_design = if design.is_empty() {
        0.0
    } else {
        design.iter().filter(|&&i| x[i] > 0.1 && x[i] < 0.9).count() as f64 / design.len() as f64
    };
    let mut map = start.clone();
    for &i in &solid {
        map.id[i] = cfg.soft;
    }
    let mut used = 0f64;
    for &i in &solid {
        if frozen[i] {
            map.id[i] = cfg.stiff;
            used += grid.scale[i] as f64;
        }
    }
    let mut rank = design.clone();
    rank.sort_by(|&a, &b| rho[b].partial_cmp(&rho[a]).unwrap_or(std::cmp::Ordering::Equal));
    for &i in &rank {
        let v = grid.scale[i] as f64;
        if used + v > s_max + 1e-9 {
            break;
        }
        map.id[i] = cfg.stiff;
        used += v;
    }

    // ---- independent verification of the binary design ----
    let (field, settings) = map.solver_inputs(grid, base).map_err(|e| format!("{e:?}"))?;
    let verify = solve_cached(&mut None, grid, levels, problem, &settings, field, base.tol, base.max_iter)
        .map_err(|e| format!("{e}"))?;
    let masses = map.masses_g(grid);
    Ok(MmResult {
        rho,
        stiff_volume_fraction: map.volume_fractions(grid)[cfg.stiff as usize],
        mass_g: masses.iter().sum(),
        map,
        iterations,
        converged,
        history,
        s_max,
        compliance_continuous: compliance,
        compliance_binary: verify.compliance,
        gray_fraction: gray,
        gray_fraction_design: gray_design,
        frozen_cells: frozen.iter().filter(|&&b| b).count(),
    })
}
