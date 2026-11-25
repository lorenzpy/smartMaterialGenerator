// SPDX-License-Identifier: AGPL-3.0-only
//
// Multi-material fork: allowable-based material assignment (baseline rule).
// New file in the fork (not part of upstream filaSim).

//! Allowable-based material assignment: the simple baseline that a future
//! multi-material optimizer has to beat.
//!
//! Two materials, a STIFF one (e.g. PLA) and a SOFT one (e.g. TPU), each with
//! the failure measure that suits it:
//!
//! - stiff material: **stress** limit (von Mises vs an allowable stress);
//! - soft material: **strain** limit (stress-equivalent strain `σ_vm/E` vs an
//!   allowable strain) — a soft elastomer fails by how far it stretches, not
//!   by how much stress it carries.
//!
//! The rule: a cell may be soft only where the stress it would carry stays
//! below `E_soft · ε_allow` (i.e. it would not exceed its strain limit);
//! everywhere else it must stay stiff. Because swapping a cell to the soft
//! material redistributes load, the rule is iterated with three safeguards:
//! a move limit (only a fraction of candidates flips per iteration), a revert
//! step (a soft cell whose real strain exceeds the limit goes back to stiff
//! and is then LOCKED stiff, which guarantees termination), and an optional
//! cap on the soft volume fraction. Frozen cells (supports, load patches)
//! always stay stiff.
//!
//! Limits are inputs; the numbers used in tests are placeholders. The rule
//! uses the *linear-elastic* stress/strain fields — for an elastomer far into
//! its nonlinear range that is an approximation (documented, not hidden).

use crate::fem::{NODE_OFFSETS, NODE_SIGNS};
use crate::materials::MaterialMap;
use crate::voxel::VoxelGrid;

/// Per-cell results needed by the rule (grid cell indexing).
pub struct CellFields {
    /// von Mises stress (MPa) with the cell's own material constants.
    pub vm: Vec<f32>,
    /// Stress-equivalent strain `σ_vm / E_material` (dimensionless).
    pub eq_strain: Vec<f32>,
    /// Normal stress σzz (MPa), z = build direction.
    pub szz: Vec<f32>,
}

/// Cell-center stress/strain from a nodal displacement field `u` (f32, three
/// values per node on `grid`'s node lattice, as `Solution::u`). Each cell uses
/// ITS material's `E` and `nu` from `map`. Void cells are 0.
pub fn cell_fields(grid: &VoxelGrid, u: &[f32], map: &MaterialMap) -> CellFields {
    let (nx, ny, nz) = (grid.nx, grid.ny, grid.nz);
    let (mx, my) = (nx + 1, ny + 1);
    assert_eq!(u.len(), 3 * mx * my * (nz + 1), "u does not match the grid");
    let inv4h = 1.0 / (4.0 * grid.h);
    let mut vm = vec![0f32; nx * ny * nz];
    let mut eq = vec![0f32; nx * ny * nz];
    let mut szz_out = vec![0f32; nx * ny * nz];
    for cz in 0..nz {
        for cy in 0..ny {
            for cx in 0..nx {
                let ci = (cz * ny + cy) * nx + cx;
                if grid.scale[ci] <= 0.0 {
                    continue;
                }
                let (mut exx, mut eyy, mut ezz) = (0f64, 0f64, 0f64);
                let (mut gxy, mut gyz, mut gzx) = (0f64, 0f64, 0f64);
                for l in 0..8 {
                    let [ox, oy, oz] = NODE_OFFSETS[l];
                    let [sx, sy, sz] = NODE_SIGNS[l];
                    let n = ((cz + oz) * my + (cy + oy)) * mx + (cx + ox);
                    let (ux, uy, uz) = (u[3 * n] as f64, u[3 * n + 1] as f64, u[3 * n + 2] as f64);
                    exx += sx * ux;
                    eyy += sy * uy;
                    ezz += sz * uz;
                    gxy += sy * ux + sx * uy;
                    gyz += sz * uy + sy * uz;
                    gzx += sx * uz + sz * ux;
                }
                let (exx, eyy, ezz) = (exx * inv4h, eyy * inv4h, ezz * inv4h);
                let (gxy, gyz, gzx) = (gxy * inv4h, gyz * inv4h, gzx * inv4h);
                let m = &map.table[map.id[ci] as usize];
                let lam = m.e * m.nu / ((1.0 + m.nu) * (1.0 - 2.0 * m.nu));
                let mu = m.e / (2.0 * (1.0 + m.nu));
                let tr = exx + eyy + ezz;
                let (sxx, syy, szz) = (lam * tr + 2.0 * mu * exx, lam * tr + 2.0 * mu * eyy, lam * tr + 2.0 * mu * ezz);
                let (sxy, syz, szx) = (mu * gxy, mu * gyz, mu * gzx);
                let v = (0.5 * ((sxx - syy).powi(2) + (syy - szz).powi(2) + (szz - sxx).powi(2))
                    + 3.0 * (sxy * sxy + syz * syz + szx * szx))
                    .sqrt();
                vm[ci] = v as f32;
                eq[ci] = (v / m.e) as f32;
                szz_out[ci] = szz as f32;
            }
        }
    }
    CellFields { vm, eq_strain: eq, szz: szz_out }
}

#[derive(Clone, Debug)]
pub struct ThresholdConfig {
    /// Material ids in the map's table.
    pub stiff: u8,
    pub soft: u8,
    /// Stiff material: allowable von Mises stress (MPa).
    pub stiff_stress_allow: f64,
    /// Soft material: allowable stress-equivalent strain.
    pub soft_strain_allow: f64,
    /// Both allowables are divided by this during assignment (>= 1).
    pub safety: f64,
    /// Cap on the soft volume fraction (of solid volume). `None` = no cap.
    pub max_soft_volume_fraction: Option<f64>,
    pub max_iter: usize,
    /// Share (0,1] of the current candidates switched to soft per iteration.
    pub flip_fraction: f64,
    /// Cells that must stay stiff (supports, load patches). Empty = none.
    pub frozen_stiff: Vec<bool>,
}

#[derive(Clone, Debug)]
pub struct IterRecord {
    pub iteration: usize,
    pub flipped_to_soft: usize,
    pub reverted: usize,
    pub soft_volume_fraction: f64,
    pub compliance: f64,
}

#[derive(Clone, Debug)]
pub struct ThresholdOutcome {
    pub map: MaterialMap,
    pub iterations: usize,
    pub converged: bool,
    pub history: Vec<IterRecord>,
    pub soft_volume_fraction: f64,
    pub soft_mass_fraction: f64,
    pub compliance: f64,
    /// Smallest `stiff_stress_allow / σ_vm` over stiff cells (raw allowable).
    pub sf_stiff_min: f64,
    /// Smallest `soft_strain_allow / ε_eq` over soft cells (raw allowable).
    pub sf_soft_min: f64,
    /// Cells whose raw safety factor is below 1.
    pub violating_cells: usize,
}

/// Solver callback: returns the nodal displacements and the compliance for a
/// given material map.
pub type SolveFn<'a> = dyn FnMut(&MaterialMap) -> Result<(Vec<f32>, f64), String> + 'a;

/// Run the allowable-based assignment. `start` supplies the material table and
/// reference; every solid cell begins as `cfg.stiff`.
pub fn assign_by_threshold(
    grid: &VoxelGrid,
    start: &MaterialMap,
    cfg: &ThresholdConfig,
    solve: &mut SolveFn,
) -> Result<ThresholdOutcome, String> {
    if cfg.safety < 1.0 || cfg.flip_fraction <= 0.0 || cfg.flip_fraction > 1.0 {
        return Err("safety must be >= 1 and flip_fraction in (0,1]".into());
    }
    if cfg.stiff == cfg.soft {
        return Err("stiff and soft must be different materials".into());
    }
    start.validate(grid).map_err(|e| format!("{e:?}"))?;
    let n = grid.cell_count();
    let solid: Vec<usize> = (0..n).filter(|&i| grid.scale[i] > 0.0).collect();
    let total_vol: f64 = solid.iter().map(|&i| grid.scale[i] as f64).sum();
    if total_vol <= 0.0 {
        return Err("no solid cells".into());
    }
    let soft_e = start.table[cfg.soft as usize].e;
    let strain_lim = cfg.soft_strain_allow / cfg.safety;
    let stress_cand = soft_e * strain_lim; // soft is admissible below this stress

    let mut map = start.clone();
    for &i in &solid {
        map.id[i] = cfg.stiff;
    }
    let mut locked = if cfg.frozen_stiff.len() == n { cfg.frozen_stiff.clone() } else { vec![false; n] };
    let soft_vol = |m: &MaterialMap| -> f64 {
        solid.iter().filter(|&&i| m.id[i] == cfg.soft).map(|&i| grid.scale[i] as f64).sum()
    };

    let (mut u, mut compliance) = solve(&map)?;
    let mut history = vec![IterRecord {
        iteration: 0,
        flipped_to_soft: 0,
        reverted: 0,
        soft_volume_fraction: 0.0,
        compliance,
    }];
    let mut converged = false;
    let mut iterations = 0;
    for it in 1..=cfg.max_iter {
        iterations = it;
        let f = cell_fields(grid, &u, &map);
        // 1. revert soft cells that exceed their strain limit; lock them stiff.
        let mut reverted = 0;
        for &i in &solid {
            if map.id[i] == cfg.soft && (f.eq_strain[i] as f64) > strain_lim {
                map.id[i] = cfg.stiff;
                locked[i] = true;
                reverted += 1;
            }
        }
        // 2. candidates: stiff, unlocked, stress low enough to be soft.
        let mut cands: Vec<(f32, usize)> = solid
            .iter()
            .filter(|&&i| map.id[i] == cfg.stiff && !locked[i] && (f.vm[i] as f64) <= stress_cand)
            .map(|&i| (f.vm[i], i))
            .collect();
        cands.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        let room = match cfg.max_soft_volume_fraction {
            Some(fr) => (fr * total_vol - soft_vol(&map)).max(0.0),
            None => f64::INFINITY,
        };
        let max_flips = if cands.is_empty() { 0 } else { ((cfg.flip_fraction * cands.len() as f64).ceil() as usize).max(1) };
        let (mut flipped, mut added) = (0usize, 0f64);
        for &(_, i) in cands.iter().take(max_flips) {
            let v = grid.scale[i] as f64;
            if added + v > room {
                break;
            }
            map.id[i] = cfg.soft;
            added += v;
            flipped += 1;
        }
        if reverted == 0 && flipped == 0 {
            converged = true;
            break;
        }
        let r = solve(&map)?;
        u = r.0;
        compliance = r.1;
        history.push(IterRecord {
            iteration: it,
            flipped_to_soft: flipped,
            reverted,
            soft_volume_fraction: soft_vol(&map) / total_vol,
            compliance,
        });
    }

    // Final check against the RAW allowables on the last solved state.
    let f = cell_fields(grid, &u, &map);
    let (mut sf_stiff, mut sf_soft, mut viol) = (f64::INFINITY, f64::INFINITY, 0usize);
    for &i in &solid {
        if map.id[i] == cfg.soft {
            let sf = cfg.soft_strain_allow / (f.eq_strain[i] as f64).max(1e-30);
            sf_soft = sf_soft.min(sf);
            viol += (sf < 1.0) as usize;
        } else {
            let sf = cfg.stiff_stress_allow / (f.vm[i] as f64).max(1e-30);
            sf_stiff = sf_stiff.min(sf);
            viol += (sf < 1.0) as usize;
        }
    }
    let sv = soft_vol(&map) / total_vol;
    let mass_frac = map.mass_fractions(grid)[cfg.soft as usize];
    Ok(ThresholdOutcome {
        map,
        iterations,
        converged,
        history,
        soft_volume_fraction: sv,
        soft_mass_fraction: mass_frac,
        compliance,
        sf_stiff_min: sf_stiff,
        sf_soft_min: sf_soft,
        violating_cells: viol,
    })
}
