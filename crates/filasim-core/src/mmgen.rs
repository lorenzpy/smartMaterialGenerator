// SPDX-License-Identifier: AGPL-3.0-only
//
// Multi-material fork: general N-material optimizer (stiffness / failure risk).
// New file in the fork (not part of upstream filaSim).

//! General multi-material optimizer: any number of isotropic materials with
//! any Poisson ratios, several objectives combined by weights.
//!
//! **Design variables.** Per cell, a vector of material shares `ρ_m ≥ 0`,
//! `Σ_m ρ_m = 1` (simplex). Shares are density-filtered (cone filter, rows
//! normalized, so the filtered shares stay on the simplex).
//!
//! **Stiffness.** Penalized Voigt mixture with the SOFTEST material `b` as
//! background: `C = Σ_{m≠b} ρ_m^p · C_m + (1 − Σ_{m≠b} ρ_m^p) · C_b`. The pure
//! vertices are exactly the materials; a mixture is penalized toward the
//! background by `p` (like SIMP) but can never be softer than the softest REAL
//! material. (A plain `Σ ρ_m^p C_m` makes gray cells softer than every real
//! material, which a risk objective exploits — measured, see the notes.) The
//! solver sees the tensor through [`LameBasis`], so every Poisson ratio is
//! handled without touching `mg.rs`.
//!
//! **Objective terms** (weights `w`, each normalized by its value at the
//! first iterate so weights are comparable):
//! - `Compliance` — deformation (force × displacement);
//! - `Risk` — failure risk: a volume-weighted p-norm of the failure index
//!   `f = σ_vm / σ_eff`, where each material's effective allowable
//!   `σ_eff = min(σ_allow, E·ε_allow)` folds its stress AND strain limit
//!   into one stress (valid for linear elasticity). A brittle stiff material
//!   (PLA: low strain limit) and a ductile soft one (TPU: high strain limit,
//!   low E) therefore share one scale. Gray cells use the share-weighted
//!   inverse allowable. The gradient needs one adjoint solve;
//! - linear terms — cost, mass, … as coefficient per material and volume.
//!
//! **Update.** Multiplicative (exponentiated-gradient / mirror-descent) step
//! on the simplex with a clipped exponent, adaptive step size (halved when
//! the objective rises), penalty continuation `p0 → p1`, optional linear
//! budgets enforced by bisection on a multiplier. Binarization takes the
//! largest share per cell, then repairs any violated budget greedily.
//!
//! Scope and limits: one load case, linear elasticity (also for soft
//! materials), failure index from the linear stress field, no manufacturing
//! constraints. The result is a local optimum of a relaxed problem.

use crate::eps::{EpsField, EMIN_REL};
use crate::fem::{iso_stiffness, ke_hex, NODE_OFFSETS, NODE_SIGNS};
use crate::materials::{lame, LameBasis, MaterialMap};
use crate::mmopt::Filter;
use crate::solve::{solve_cached, NodeProblem, SolveSettings, SolverCache};
use crate::voxel::VoxelGrid;

const RHO_MIN: f64 = 1e-5;
/// Exponent of the conservative failure-limit mixture (see `inv_allow`).
const MIX_K: f64 = 4.0;

/// Von Mises quadratic form `vm² = σᵀ P σ` (engineering shear, 6-vector).
const P_VM: [[f64; 6]; 6] = [
    [1.0, -0.5, -0.5, 0.0, 0.0, 0.0],
    [-0.5, 1.0, -0.5, 0.0, 0.0, 0.0],
    [-0.5, -0.5, 1.0, 0.0, 0.0, 0.0],
    [0.0, 0.0, 0.0, 3.0, 0.0, 0.0],
    [0.0, 0.0, 0.0, 0.0, 3.0, 0.0],
    [0.0, 0.0, 0.0, 0.0, 0.0, 3.0],
];

fn mv24(k: &[[f64; 24]; 24], u: &[f64; 24]) -> [f64; 24] {
    let mut y = [0f64; 24];
    for i in 0..24 {
        let mut s = 0.0;
        for j in 0..24 {
            s += k[i][j] * u[j];
        }
        y[i] = s;
    }
    y
}

fn mv6(a: &[[f64; 6]; 6], x: &[f64; 6]) -> [f64; 6] {
    let mut y = [0f64; 6];
    for i in 0..6 {
        for j in 0..6 {
            y[i] += a[i][j] * x[j];
        }
    }
    y
}

fn dot<const N: usize>(a: &[f64; N], b: &[f64; N]) -> f64 {
    (0..N).map(|i| a[i] * b[i]).sum()
}

/// Evaluation result for one design.
pub struct Eval {
    pub compliance: f64,
    /// Volume-weighted p-norm of the failure index (0 if not requested).
    pub risk: f64,
    /// Largest failure index over the counted cells.
    pub risk_max: f64,
    pub max_disp: f64,
    /// `dC/dρ`, flat `[cell * n_mat + m]`, w.r.t. the PHYSICAL (filtered) shares.
    pub grad_c: Vec<f64>,
    /// `dR/dρ`, same layout; empty if risk was not requested.
    pub grad_r: Vec<f64>,
}

/// Fixed data plus the cached multigrid hierarchy.
pub struct MgContext<'a> {
    grid: &'a VoxelGrid,
    levels: usize,
    problem: &'a NodeProblem,
    settings: SolveSettings,
    basis: LameBasis,
    n_mat: usize,
    /// Background (softest) material index.
    bg: usize,
    ke: Vec<[[f64; 24]; 24]>,
    cm: Vec<[[f64; 6]; 6]>,
    lm: Vec<(f64, f64)>,
    /// `1/σ_eff` per material (0 = no limit).
    inv_sig: Vec<f64>,
    /// `1/σ_z` per material: allowable tension across layers (0 = no limit).
    inv_sigz: Vec<f64>,
    /// Layer-adhesion check on (grid z is the build direction).
    layer_on: bool,
    /// Bond factor κ in (0,1] between DIFFERENT materials in z-neighbour cells.
    bond: f64,
    b: [[f64; 24]; 6],
    occ: Vec<f64>,
    /// Cells counted in the risk (solid and not excluded).
    mask: Vec<bool>,
    mask_vol: f64,
    slot: Option<SolverCache>,
    pub last_u: Vec<f64>,
    /// Last adjoint solution (warm start for the next adjoint solve).
    adj_u: Vec<f64>,
}

impl<'a> MgContext<'a> {
    /// `risk_mask` empty = all solid cells count.
    pub fn new(
        grid: &'a VoxelGrid,
        levels: usize,
        problem: &'a NodeProblem,
        map: &MaterialMap,
        risk_mask: &[bool],
        base: SolveSettings,
    ) -> Result<Self, String> {
        map.validate(grid).map_err(|e| format!("{e:?}"))?;
        let t = &map.table;
        let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
        for m in t {
            lo = lo.min(m.nu);
            hi = hi.max(m.nu);
        }
        let basis = LameBasis::new(map.e_ref(), lo, hi);
        let settings = basis.settings(base);
        let inv_h = 1.0 / (4.0 * grid.h);
        let mut b = [[0f64; 24]; 6];
        for l in 0..8 {
            let [sx, sy, sz] = NODE_SIGNS[l];
            b[0][3 * l] = sx * inv_h;
            b[1][3 * l + 1] = sy * inv_h;
            b[2][3 * l + 2] = sz * inv_h;
            b[3][3 * l] = sy * inv_h;
            b[3][3 * l + 1] = sx * inv_h;
            b[4][3 * l + 1] = sz * inv_h;
            b[4][3 * l + 2] = sy * inv_h;
            b[5][3 * l + 2] = sx * inv_h;
            b[5][3 * l] = sz * inv_h;
        }
        let occ: Vec<f64> = grid
            .scale
            .iter()
            .map(|&s| if s > 0.0 { EMIN_REL as f64 + (1.0 - EMIN_REL as f64) * s as f64 } else { 0.0 })
            .collect();
        let mask: Vec<bool> = (0..grid.cell_count())
            .map(|i| grid.scale[i] > 0.0 && (risk_mask.is_empty() || risk_mask[i]))
            .collect();
        let mask_vol = (0..grid.cell_count()).filter(|&i| mask[i]).map(|i| grid.scale[i] as f64).sum();
        Ok(Self {
            grid,
            levels,
            problem,
            settings,
            basis,
            n_mat: t.len(),
            bg: (0..t.len()).min_by(|&a, &b| t[a].e.partial_cmp(&t[b].e).unwrap()).unwrap(),
            ke: t.iter().map(|m| ke_hex(m.e, m.nu, grid.h)).collect(),
            cm: t.iter().map(|m| iso_stiffness(m.e, m.nu)).collect(),
            lm: t.iter().map(|m| lame(m.e, m.nu)).collect(),
            inv_sig: t
                .iter()
                .map(|m| {
                    let s = m.sigma_eff();
                    if s.is_finite() && s > 0.0 { 1.0 / s } else { 0.0 }
                })
                .collect(),
            inv_sigz: t
                .iter()
                .map(|m| if m.stress_allow_z.is_finite() && m.stress_allow_z > 0.0 { 1.0 / m.stress_allow_z } else { 0.0 })
                .collect(),
            layer_on: false,
            bond: 1.0,
            b,
            occ,
            mask,
            mask_vol,
            slot: None,
            last_u: Vec::new(),
            adj_u: Vec::new(),
        })
    }

    pub fn n_mat(&self) -> usize {
        self.n_mat
    }

    /// Conservative mixture of the failure limits of a cell: the share-weighted
    /// soft-max of the inverse allowables, `(Σ ρ_m (1/σ_m)^k)^(1/k)`. For
    /// large `k` it follows the WEAKEST material that is present, so a gray
    /// mixture cannot look stronger than its weakest ingredient (a plain
    /// linear average would let the optimizer hide soft, weak material behind
    /// a strong-looking gray cell). Returns the value and `d/dρ_m`.
    fn inv_allow(&self, rho: &[f64], ci: usize) -> (f64, Vec<f64>) {
        self.softmax_inv(rho, ci, &self.inv_sig)
    }

    fn softmax_inv(&self, rho: &[f64], ci: usize, w: &[f64]) -> (f64, Vec<f64>) {
        let nm = self.n_mat;
        let k = MIX_K;
        let s: f64 = (0..nm).map(|m| rho[ci * nm + m].clamp(RHO_MIN, 1.0) * w[m].powf(k)).sum();
        if s <= 0.0 {
            return (0.0, vec![0.0; nm]);
        }
        let inv = s.powf(1.0 / k);
        let pref = s.powf(1.0 / k - 1.0) / k;
        (inv, (0..nm).map(|m| pref * w[m].powf(k)).collect())
    }

    /// Switch the layer-adhesion check on. `bond` is the strength factor κ of
    /// an interface between two different materials relative to the weaker
    /// one (1 = as strong as the weaker material itself).
    pub fn set_layer_adhesion(&mut self, on: bool, bond: f64) {
        self.layer_on = on;
        self.bond = bond.clamp(0.05, 1.0);
    }

    /// z-neighbours (up, down) of a cell that are solid.
    fn z_neighbours(&self, ci: usize) -> (Option<usize>, Option<usize>) {
        let g = self.grid;
        let nxy = g.nx * g.ny;
        let cz = ci / nxy;
        let up = if cz + 1 < g.nz && self.occ[ci + nxy] > 0.0 { Some(ci + nxy) } else { None };
        let dn = if cz > 0 && self.occ[ci - nxy] > 0.0 { Some(ci - nxy) } else { None };
        (up, dn)
    }

    /// Layer-adhesion inverse allowable of a cell:
    /// `invZ = softmax(1/σ_z) · (1 + (1/κ − 1) D)`, with the interface measure
    /// `D = ½ Σ_n (1 − Σ_m ρ_m ρ_{n,m})` over the solid z-neighbours (0 for a
    /// uniform column, 1 across a sharp interface). Returns
    /// `(invZ, mix, dmix, D, up, dn)`.
    fn inv_layer(&self, rho: &[f64], ci: usize) -> (f64, f64, Vec<f64>, f64, Option<usize>, Option<usize>) {
        let nm = self.n_mat;
        let (mix, dmix) = self.softmax_inv(rho, ci, &self.inv_sigz);
        let (up, dn) = self.z_neighbours(ci);
        let mut d = 0.0;
        for nb in [up, dn].into_iter().flatten() {
            let same: f64 = (0..nm).map(|m| rho[ci * nm + m] * rho[nb * nm + m]).sum();
            d += 0.5 * (1.0 - same);
        }
        (mix * (1.0 + (1.0 / self.bond - 1.0) * d), mix, dmix, d, up, dn)
    }

    fn gather(&self, u: &[f64], ci: usize) -> [f64; 24] {
        let g = self.grid;
        let (mx, my) = (g.nx + 1, g.ny + 1);
        let (cx, cy, cz) = (ci % g.nx, (ci / g.nx) % g.ny, ci / (g.nx * g.ny));
        let mut ul = [0f64; 24];
        for l in 0..8 {
            let [ox, oy, oz] = NODE_OFFSETS[l];
            let nd = ((cz + oz) * my + (cy + oy)) * mx + (cx + ox);
            ul[3 * l..3 * l + 3].copy_from_slice(&u[3 * nd..3 * nd + 3]);
        }
        ul
    }

    /// Mixture weights: `ρ_m^p` for every material but the background; the
    /// background takes the remainder (so the weights always sum to 1).
    fn phis(&self, rho: &[f64], ci: usize, p: f64) -> Vec<f64> {
        let nm = self.n_mat;
        let mut phi: Vec<f64> = (0..nm).map(|m| rho[ci * nm + m].clamp(RHO_MIN, 1.0).powf(p)).collect();
        phi[self.bg] = 0.0;
        let rest: f64 = phi.iter().sum();
        phi[self.bg] = (1.0 - rest).max(0.0);
        phi
    }

    /// `a'_k = p ρ_k^(p-1)` for `k ≠ bg`, 0 for the background (its share only
    /// acts through the simplex constraint).
    fn dphi(&self, rho: &[f64], ci: usize, k: usize, p: f64) -> f64 {
        if k == self.bg {
            0.0
        } else {
            p * rho[ci * self.n_mat + k].clamp(RHO_MIN, 1.0).powf(p - 1.0)
        }
    }

    /// Forward solve (and, if `need_risk`, the adjoint) for the filtered
    /// shares `rho` at penalty `p` and risk exponent `q`.
    pub fn eval(&mut self, rho: &[f64], p: f64, q: f64, need_risk: bool) -> Result<Eval, String> {
        let g = self.grid;
        let (n, nm) = (g.cell_count(), self.n_mat);
        assert_eq!(rho.len(), n * nm);

        // ---- forward ----
        let (mut wa, mut wb) = (vec![0f32; n], vec![0f32; n]);
        for ci in 0..n {
            if self.occ[ci] <= 0.0 {
                continue;
            }
            let phi = self.phis(rho, ci, p);
            let (mut l, mut m) = (0.0, 0.0);
            for k in 0..nm {
                l += phi[k] * self.lm[k].0;
                m += phi[k] * self.lm[k].1;
            }
            let (a, b) = self.basis.weights(self.occ[ci] * l, self.occ[ci] * m);
            wa[ci] = a as f32;
            wb[ci] = b as f32;
        }
        let field = if self.basis.is_degenerate() { EpsField::from(wa) } else { EpsField::ti(wa, wb) };
        let r = solve_cached(&mut self.slot, g, self.levels, self.problem, &self.settings, field, self.settings.tol, self.settings.max_iter)
            .map_err(|e| format!("{e}"))?;
        self.last_u = r.u;
        let compliance = r.compliance;
        let max_disp = self
            .last_u
            .chunks(3)
            .map(|c| (c[0] * c[0] + c[1] * c[1] + c[2] * c[2]).sqrt())
            .fold(0.0, f64::max);

        // ---- compliance sensitivity ----
        let mut grad_c = vec![0f64; n * nm];
        for ci in 0..n {
            if self.occ[ci] <= 0.0 {
                continue;
            }
            let ue = self.gather(&self.last_u, ci);
            let se_bg = dot(&ue, &mv24(&self.ke[self.bg], &ue));
            for k in 0..nm {
                if k == self.bg {
                    continue;
                }
                let se = dot(&ue, &mv24(&self.ke[k], &ue));
                grad_c[ci * nm + k] = -self.occ[ci] * self.dphi(rho, ci, k, p) * (se - se_bg);
            }
        }
        if !need_risk {
            return Ok(Eval { compliance, risk: 0.0, risk_max: 0.0, max_disp, grad_c, grad_r: Vec::new() });
        }

        // ---- risk: pass 1 (failure index, p-norm) ----
        let mut fvals = vec![0f64; n];
        let mut sum = 0f64;
        let mut fmax = 0f64;
        for ci in 0..n {
            if !self.mask[ci] {
                continue;
            }
            let (vm, sg, inv_s, _) = self.stress_state(rho, ci, p);
            let mut f2 = (vm * inv_s).powi(2);
            if self.layer_on {
                let t = sg[2].max(0.0);
                f2 += (t * self.inv_layer(rho, ci).0).powi(2);
            }
            let f = f2.sqrt();
            fvals[ci] = f;
            fmax = fmax.max(f);
            sum += g.scale[ci] as f64 * f.powf(q);
        }
        let mean = (sum / self.mask_vol).max(1e-300);
        let risk = mean.powf(1.0 / q);

        // ---- risk: pass 2 (explicit gradient + adjoint load) ----
        let mut grad_r = vec![0f64; n * nm];
        let ndof = self.last_u.len();
        let mut gload = vec![0f64; ndof];
        let (mx, my) = (g.nx + 1, g.ny + 1);
        for ci in 0..n {
            if !self.mask[ci] || fvals[ci] <= 0.0 {
                continue;
            }
            let v = g.scale[ci] as f64;
            let c_i = mean.powf(1.0 / q - 1.0) * v * fvals[ci].powf(q - 1.0) / self.mask_vol;
            let ue = self.gather(&self.last_u, ci);
            let eps6 = {
                let mut e = [0f64; 6];
                for r in 0..6 {
                    for j in 0..24 {
                        e[r] += self.b[r][j] * ue[j];
                    }
                }
                e
            };
            let phi = self.phis(rho, ci, p);
            let mut sigma = [0f64; 6];
            let mut s_m: Vec<[f64; 6]> = Vec::with_capacity(nm);
            for k in 0..nm {
                let s = mv6(&self.cm[k], &eps6);
                for r in 0..6 {
                    sigma[r] += phi[k] * s[r];
                }
                s_m.push(s);
            }
            let ps = mv6(&P_VM, &sigma);
            let vm = dot(&sigma, &ps).max(1e-30).sqrt();
            let dir = [ps[0] / vm, ps[1] / vm, ps[2] / vm, ps[3] / vm, ps[4] / vm, ps[5] / vm];
            let (inv_s, dinv) = self.inv_allow(rho, ci);
            // Layer adhesion: f² = (vm·invS)² + (t·invZ)², t = max(σzz, 0).
            let t = if self.layer_on { sigma[2].max(0.0) } else { 0.0 };
            let lay = if self.layer_on { Some(self.inv_layer(rho, ci)) } else { None };
            let inv_z = lay.as_ref().map(|l| l.0).unwrap_or(0.0);
            let fv = fvals[ci];
            let a1 = vm * inv_s * inv_s / fv; // weight of ∂vm
            let a2 = if t > 0.0 { t * inv_z * inv_z / fv } else { 0.0 }; // weight of ∂t
            for k in 0..nm {
                let (dvm, dt) = if k == self.bg {
                    (0.0, 0.0)
                } else {
                    let mut diff = [0f64; 6];
                    for r in 0..6 {
                        diff[r] = s_m[k][r] - s_m[self.bg][r];
                    }
                    let dp = self.dphi(rho, ci, k, p);
                    (dp * dot(&dir, &diff), if t > 0.0 { dp * diff[2] } else { 0.0 })
                };
                let mut gk = a1 * dvm + vm * vm * inv_s * dinv[k] / fv;
                if let Some((_, mix, dmix, dd, up, dn)) = lay.as_ref() {
                    let fac = 1.0 + (1.0 / self.bond - 1.0) * dd;
                    let mut dd_k = 0.0;
                    for nb in [up, dn].into_iter().flatten() {
                        dd_k += -0.5 * rho[nb * nm + k];
                        // neighbour's own share enters D as well
                        if t > 0.0 {
                            let dinvz_nb = mix * (1.0 / self.bond - 1.0) * (-0.5 * rho[ci * nm + k]);
                            grad_r[nb * nm + k] += c_i * t * t * inv_z * dinvz_nb / fv;
                        }
                    }
                    let dinvz = dmix[k] * fac + mix * (1.0 / self.bond - 1.0) * dd_k;
                    gk += a2 * dt + t * t * inv_z * dinvz / fv;
                }
                grad_r[ci * nm + k] += c_i * gk;
            }
            // adjoint load: c_i · ∂f/∂u = c_i · Bᵀ C_eff (a1·dir + a2·e_z)
            let mut ceff = [[0f64; 6]; 6];
            for k in 0..nm {
                for a in 0..6 {
                    for b2 in 0..6 {
                        ceff[a][b2] += phi[k] * self.cm[k][a][b2];
                    }
                }
            }
            let mut dirz = [a1 * dir[0], a1 * dir[1], a1 * dir[2], a1 * dir[3], a1 * dir[4], a1 * dir[5]];
            dirz[2] += a2;
            let w = mv6(&ceff, &dirz);
            let (cx, cy, cz) = (ci % g.nx, (ci / g.nx) % g.ny, ci / (g.nx * g.ny));
            for l in 0..8 {
                let [ox, oy, oz] = NODE_OFFSETS[l];
                let nd = ((cz + oz) * my + (cy + oy)) * mx + (cx + ox);
                for d in 0..3 {
                    let mut s = 0.0;
                    for r in 0..6 {
                        s += self.b[r][3 * l + d] * w[r];
                    }
                    gload[3 * nd + d] += c_i * s;
                }
            }
        }

        // ---- adjoint solve: K λ = ∂R/∂u ----
        let nodes = ndof / 3;
        let forces: Vec<(u32, [f64; 3])> = (0..nodes)
            .filter(|&nd| gload[3 * nd] != 0.0 || gload[3 * nd + 1] != 0.0 || gload[3 * nd + 2] != 0.0)
            .map(|nd| (nd as u32, [gload[3 * nd], gload[3 * nd + 1], gload[3 * nd + 2]]))
            .collect();
        let adj = NodeProblem {
            fixed: self.problem.fixed.clone(),
            springs: self.problem.springs.clone(),
            forces,
            rigid: self.problem.rigid.clone(),
            prescribed: Vec::new(),
        };
        // Same eps as the forward solve: hierarchy and values are reused.
        let (mut wa2, mut wb2) = (vec![0f32; n], vec![0f32; n]);
        for ci in 0..n {
            if self.occ[ci] <= 0.0 {
                continue;
            }
            let phi = self.phis(rho, ci, p);
            let (mut l, mut m) = (0.0, 0.0);
            for k in 0..nm {
                l += phi[k] * self.lm[k].0;
                m += phi[k] * self.lm[k].1;
            }
            let (a, b) = self.basis.weights(self.occ[ci] * l, self.occ[ci] * m);
            wa2[ci] = a as f32;
            wb2[ci] = b as f32;
        }
        let field2 = if self.basis.is_degenerate() { EpsField::from(wa2) } else { EpsField::ti(wa2, wb2) };
        let forward_u = self.last_u.clone();
        // Warm start the adjoint from the previous adjoint (not from the
        // forward field the cache currently holds), then put the forward
        // field back so the next forward solve warm-starts from itself.
        if self.adj_u.len() == forward_u.len() {
            if let Some(c) = self.slot.as_mut() {
                c.last_u.copy_from_slice(&self.adj_u);
            }
        }
        let lam = solve_cached(&mut self.slot, g, self.levels, &adj, &self.settings, field2, self.settings.tol, self.settings.max_iter)
            .map_err(|e| format!("adjoint: {e}"))?
            .u;
        if let Some(c) = self.slot.as_mut() {
            c.last_u.copy_from_slice(&forward_u);
        }
        self.adj_u = lam.clone();
        self.last_u = forward_u;
        for ci in 0..n {
            if self.occ[ci] <= 0.0 {
                continue;
            }
            let ue = self.gather(&self.last_u, ci);
            let le = self.gather(&lam, ci);
            let t_bg = dot(&le, &mv24(&self.ke[self.bg], &ue));
            for k in 0..nm {
                if k == self.bg {
                    continue;
                }
                let t = dot(&le, &mv24(&self.ke[k], &ue));
                grad_r[ci * nm + k] -= self.occ[ci] * self.dphi(rho, ci, k, p) * (t - t_bg);
            }
        }
        Ok(Eval { compliance, risk, risk_max: fmax, max_disp, grad_c, grad_r })
    }

    /// `(vm, sigma, invS, phi)` of a cell for the shares `rho` at penalty `p`.
    fn stress_state(&self, rho: &[f64], ci: usize, p: f64) -> (f64, [f64; 6], f64, Vec<f64>) {
        let nm = self.n_mat;
        let ue = self.gather(&self.last_u, ci);
        let mut e = [0f64; 6];
        for r in 0..6 {
            for j in 0..24 {
                e[r] += self.b[r][j] * ue[j];
            }
        }
        let phi = self.phis(rho, ci, p);
        let mut sigma = [0f64; 6];
        for k in 0..nm {
            let s = mv6(&self.cm[k], &e);
            for r in 0..6 {
                sigma[r] += phi[k] * s[r];
            }
        }
        let ps = mv6(&P_VM, &sigma);
        let vm = dot(&sigma, &ps).max(0.0).sqrt();
        let (inv_s, _) = self.inv_allow(rho, ci);
        (vm, sigma, inv_s, phi)
    }
}

/// Metrics of a binary (pure-material) design, from an independent solve.
#[derive(Clone, Debug)]
pub struct Metrics {
    pub compliance: f64,
    pub max_disp: f64,
    /// Largest failure index over the counted cells.
    pub risk_max: f64,
    /// Volume-weighted p-norm (exponent `q`) over the counted cells.
    pub risk_pnorm: f64,
    /// Counted cells with failure index > 1.
    pub failing_cells: usize,
    pub volume_fractions: Vec<f64>,
    pub mass_g: f64,
}

/// Evaluate a binary material map through [`MaterialMap::solver_inputs`].
pub fn evaluate_design(
    grid: &VoxelGrid,
    levels: usize,
    problem: &NodeProblem,
    map: &MaterialMap,
    risk_mask: &[bool],
    q: f64,
    base: SolveSettings,
) -> Result<Metrics, String> {
    evaluate_design_layered(grid, levels, problem, map, risk_mask, q, base, None)
}

/// [`evaluate_design`] with an optional layer-adhesion check: `layer =
/// Some(bond)` adds the tension across layers (σzz, grid z = build direction)
/// against each material's `stress_allow_z`, reduced by the bond factor where
/// a z-neighbour is a different material. Same failure index as the optimizer.
pub fn evaluate_design_layered(
    grid: &VoxelGrid,
    levels: usize,
    problem: &NodeProblem,
    map: &MaterialMap,
    risk_mask: &[bool],
    q: f64,
    base: SolveSettings,
    layer: Option<f64>,
) -> Result<Metrics, String> {
    let (field, settings) = map.solver_inputs(grid, base).map_err(|e| format!("{e:?}"))?;
    let r = solve_cached(&mut None, grid, levels, problem, &settings, field, settings.tol, settings.max_iter)
        .map_err(|e| format!("{e}"))?;
    let max_disp = r.u.chunks(3).map(|c| (c[0] * c[0] + c[1] * c[1] + c[2] * c[2]).sqrt()).fold(0.0, f64::max);
    let uf: Vec<f32> = r.u.iter().map(|&v| v as f32).collect();
    let f = crate::threshold::cell_fields(grid, &uf, map);
    let (mut vol, mut sum, mut fmax, mut failing) = (0f64, 0f64, 0f64, 0usize);
    for i in 0..grid.cell_count() {
        if grid.scale[i] <= 0.0 || !(risk_mask.is_empty() || risk_mask[i]) {
            continue;
        }
        let s = map.table[map.id[i] as usize].sigma_eff();
        let mut fi = if s.is_finite() && s > 0.0 { f.vm[i] as f64 / s } else { 0.0 };
        if let Some(bond) = layer {
            let sz = map.table[map.id[i] as usize].stress_allow_z;
            if sz.is_finite() && sz > 0.0 {
                let (nxy, cz) = (grid.nx * grid.ny, i / (grid.nx * grid.ny));
                let mut d = 0.0;
                if cz + 1 < grid.nz && grid.scale[i + nxy] > 0.0 && map.id[i + nxy] != map.id[i] {
                    d += 0.5;
                }
                if cz > 0 && grid.scale[i - nxy] > 0.0 && map.id[i - nxy] != map.id[i] {
                    d += 0.5;
                }
                let tz = (f.szz[i] as f64).max(0.0) / sz * (1.0 + (1.0 / bond.clamp(0.05, 1.0) - 1.0) * d);
                fi = (fi * fi + tz * tz).sqrt();
            }
        }
        vol += grid.scale[i] as f64;
        sum += grid.scale[i] as f64 * fi.powf(q);
        fmax = fmax.max(fi);
        failing += (fi > 1.0) as usize;
    }
    Ok(Metrics {
        compliance: r.compliance,
        max_disp,
        risk_max: fmax,
        risk_pnorm: if vol > 0.0 { (sum / vol).powf(1.0 / q) } else { 0.0 },
        failing_cells: failing,
        volume_fractions: map.volume_fractions(grid),
        mass_g: map.masses_g(grid).iter().sum(),
    })
}

/// Linear budget `Σ_i v_i Σ_m coeff_m ρ_im ≤ max` (v = occupancy-weighted
/// cell volume in cell units). E.g. coeff = density × cell volume for a mass
/// cap, or an indicator of one material for a share cap.
#[derive(Clone, Debug)]
pub struct Budget {
    pub coeff: Vec<f64>,
    pub max: f64,
}

#[derive(Clone, Debug)]
pub struct MgConfig {
    pub w_compliance: f64,
    pub w_risk: f64,
    /// Extra linear terms (coefficient per material per unit volume, weight).
    pub linear_terms: Vec<(Vec<f64>, f64)>,
    pub risk_exponent: f64,
    pub budgets: Vec<Budget>,
    pub filter_radius_cells: f64,
    pub penalty_start: f64,
    pub penalty_end: f64,
    pub penalty_step: f64,
    pub iters_per_penalty: usize,
    pub max_iter: usize,
    /// Initial step size of the multiplicative update.
    pub step: f64,
    /// Clip of the (normalized) gradient exponent per iteration.
    pub max_exponent: f64,
    /// Convergence: mean share change at the final penalty.
    pub tol_mean_change: f64,
    /// Per cell: `-1` free, `>= 0` fixed to that material. Empty = none.
    pub fixed_material: Vec<i16>,
    /// Cells counted in the risk. Empty = all solid cells.
    pub risk_mask: Vec<bool>,
    /// Inner (multigrid-CG) tolerance and iteration cap used INSIDE the
    /// optimization loop. Inexact inner solves with warm start are standard
    /// in topology optimization; the final verification always uses `base`.
    pub inner_tol: f64,
    pub inner_max_iter: usize,
    /// Initial shares of every free cell (length = number of materials,
    /// sums to 1). Empty = uniform. The result can depend on the start: the
    /// problem is non-convex.
    pub init_share: Vec<f64>,
    /// Layer-adhesion check (grid z = build direction); `None` = off, `Some`
    /// = bond factor κ between different materials in z-neighbour cells.
    pub layer_bond: Option<f64>,
}

impl MgConfig {
    pub fn new() -> Self {
        Self {
            w_compliance: 1.0,
            w_risk: 1.0,
            linear_terms: Vec::new(),
            risk_exponent: 8.0,
            budgets: Vec::new(),
            filter_radius_cells: 1.5,
            penalty_start: 1.0,
            penalty_end: 3.0,
            penalty_step: 0.5,
            iters_per_penalty: 15,
            max_iter: 300,
            step: 1.0,
            max_exponent: 0.7,
            tol_mean_change: 2e-4,
            fixed_material: Vec::new(),
            risk_mask: Vec::new(),
            inner_tol: 1e-4,
            inner_max_iter: 300,
            init_share: Vec::new(),
            layer_bond: None,
        }
    }
}

impl Default for MgConfig {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Debug)]
pub struct MgIter {
    pub iteration: usize,
    pub penalty: f64,
    pub objective: f64,
    pub compliance: f64,
    pub risk: f64,
    pub step: f64,
    pub mean_change: f64,
    pub rejected: bool,
}

#[derive(Clone, Debug)]
pub struct MgResult {
    pub map: MaterialMap,
    /// Filtered shares at the end, flat `[cell * n_mat + m]`.
    pub shares: Vec<f64>,
    pub iterations: usize,
    pub converged: bool,
    pub history: Vec<MgIter>,
    /// Share of free cells whose largest filtered share is below 0.9.
    pub gray_fraction: f64,
    /// Metrics of the binarized design (independent solve).
    pub metrics: Metrics,
    /// Risk (p-norm) and compliance of the last CONTINUOUS iterate, from the
    /// relaxed model — compare with `metrics` to see what binarization costs.
    pub continuous_risk: f64,
    pub continuous_compliance: f64,
    /// Normalizers (compliance, risk, linear terms) taken at the first
    /// iterate; the same values rank candidates in [`optimize_best_of`].
    pub norm_c: f64,
    pub norm_r: f64,
    pub norm_l: Vec<f64>,
    /// Per budget: (usage of the binary design, limit).
    pub budget_usage: Vec<(f64, f64)>,
}

fn column(x: &[f64], n: usize, nm: usize, m: usize) -> Vec<f64> {
    (0..n).map(|i| x[i * nm + m]).collect()
}

fn filter_all(f: &Filter, x: &[f64], n: usize, nm: usize) -> Vec<f64> {
    let mut out = vec![0f64; x.len()];
    for m in 0..nm {
        let c = f.apply(&column(x, n, nm, m));
        for i in 0..n {
            out[i * nm + m] = c[i];
        }
    }
    out
}

fn filter_all_t(f: &Filter, g: &[f64], n: usize, nm: usize) -> Vec<f64> {
    let mut out = vec![0f64; g.len()];
    for m in 0..nm {
        let c = f.apply_t(&column(g, n, nm, m));
        for i in 0..n {
            out[i * nm + m] = c[i];
        }
    }
    out
}

fn budget_usage(grid: &VoxelGrid, shares: &[f64], nm: usize, coeff: &[f64]) -> f64 {
    let mut u = 0.0;
    for i in 0..grid.cell_count() {
        let v = grid.scale[i] as f64;
        if v > 0.0 {
            for m in 0..nm {
                u += v * coeff[m] * shares[i * nm + m];
            }
        }
    }
    u
}

/// Run the optimization on the padded solver grid. `start` supplies the
/// material table (and reference); its cell ids are ignored.
pub fn optimize_multi_material(
    grid: &VoxelGrid,
    levels: usize,
    problem: &NodeProblem,
    start: &MaterialMap,
    cfg: &MgConfig,
    base: SolveSettings,
) -> Result<MgResult, String> {
    optimize_multi_material_with(grid, levels, problem, start, cfg, base, &mut |_| true)
}

/// [`optimize_multi_material`] with a per-iteration callback. Returning
/// `false` stops the iteration early; the current design is still binarized
/// and verified, so the caller gets a usable (unconverged) result.
pub fn optimize_multi_material_with(
    grid: &VoxelGrid,
    levels: usize,
    problem: &NodeProblem,
    start: &MaterialMap,
    cfg: &MgConfig,
    base: SolveSettings,
    progress: &mut dyn FnMut(&MgIter) -> bool,
) -> Result<MgResult, String> {
    let n = grid.cell_count();
    let nm = start.table.len();
    if nm < 2 {
        return Err("need at least two materials".into());
    }
    for b in &cfg.budgets {
        if b.coeff.len() != nm {
            return Err("budget coefficient count must equal the number of materials".into());
        }
    }
    for (c, _) in &cfg.linear_terms {
        if c.len() != nm {
            return Err("linear term coefficient count must equal the number of materials".into());
        }
    }
    let need_risk = cfg.w_risk != 0.0;
    let mut inner = base;
    inner.tol = cfg.inner_tol.max(base.tol);
    inner.max_iter = cfg.inner_max_iter.min(base.max_iter).max(10);
    let mut ctx = MgContext::new(grid, levels, problem, start, &cfg.risk_mask, inner)?;
    ctx.set_layer_adhesion(cfg.layer_bond.is_some(), cfg.layer_bond.unwrap_or(1.0));
    let solid: Vec<usize> = (0..n).filter(|&i| grid.scale[i] > 0.0).collect();
    if solid.is_empty() {
        return Err("no solid cells".into());
    }
    let fixed: Vec<i16> = if cfg.fixed_material.len() == n { cfg.fixed_material.clone() } else { vec![-1; n] };
    let is_free = |i: usize| grid.scale[i] > 0.0 && fixed[i] < 0;
    let free: Vec<usize> = solid.iter().copied().filter(|&i| is_free(i)).collect();
    let vol: Vec<f64> = (0..n).map(|i| grid.scale[i].max(0.0) as f64).collect();

    // ---- init ----
    let mut x = vec![0f64; n * nm];
    for &i in &solid {
        if fixed[i] >= 0 {
            for m in 0..nm {
                x[i * nm + m] = if m as i16 == fixed[i] { 1.0 - (nm - 1) as f64 * RHO_MIN } else { RHO_MIN };
            }
        } else if cfg.init_share.len() == nm {
            let z: f64 = cfg.init_share.iter().sum();
            for m in 0..nm {
                x[i * nm + m] = (cfg.init_share[m] / z).max(RHO_MIN);
            }
        } else {
            for m in 0..nm {
                x[i * nm + m] = 1.0 / nm as f64;
            }
        }
    }
    let filter = Filter::build(grid, cfg.filter_radius_cells);
    let n_steps = ((cfg.penalty_end - cfg.penalty_start) / cfg.penalty_step).round().max(0.0) as usize;
    let ips = cfg.iters_per_penalty.max(1);
    let p_of = |it: usize| cfg.penalty_start + (it / ips).min(n_steps) as f64 * cfg.penalty_step;
    let final_start = n_steps * ips;

    // normalizers from the first evaluation
    let (mut c0, mut r0): (f64, f64) = (1.0, 1.0);
    let mut l0: Vec<f64> = vec![1.0; cfg.linear_terms.len()];
    let lin_val = |shares: &[f64], coeff: &[f64]| budget_usage(grid, shares, nm, coeff);

    let objective = |ev: &Eval, rho_t: &[f64], c0: f64, r0: f64, l0: &[f64]| -> f64 {
        let mut j = cfg.w_compliance * ev.compliance / c0;
        if need_risk {
            j += cfg.w_risk * ev.risk / r0;
        }
        for (k, (coeff, w)) in cfg.linear_terms.iter().enumerate() {
            j += w * lin_val(rho_t, coeff) / l0[k];
        }
        j
    };

    // multiplicative update on the simplex, with budget multipliers
    let update = |x: &[f64], gx: &[f64], eta: f64, lambdas: &[f64], cbar: &[Vec<f64>]| -> Vec<f64> {
        // per-volume gradient scale
        let mut gs = 0.0;
        for &i in &free {
            let mut mx = 0f64;
            for m in 0..nm {
                mx = mx.max((gx[i * nm + m] / vol[i]).abs());
            }
            gs += mx;
        }
        let gscale = (gs / free.len().max(1) as f64).max(1e-300);
        let mut out = x.to_vec();
        for &i in &free {
            let mut z = 0.0;
            for m in 0..nm {
                let gamma = gx[i * nm + m] / (vol[i] * gscale);
                let mut s = (eta * gamma).clamp(-cfg.max_exponent, cfg.max_exponent);
                for (b, l) in lambdas.iter().enumerate() {
                    s += l * cbar[b][m];
                }
                let v = (x[i * nm + m].max(RHO_MIN) * (-s).exp()).max(RHO_MIN * 1e-3);
                out[i * nm + m] = v;
                z += v;
            }
            let mut z2 = 0.0;
            for m in 0..nm {
                let v = (out[i * nm + m] / z).max(RHO_MIN);
                out[i * nm + m] = v;
                z2 += v;
            }
            for m in 0..nm {
                out[i * nm + m] /= z2;
            }
        }
        out
    };
    let cbar: Vec<Vec<f64>> = cfg
        .budgets
        .iter()
        .map(|b| {
            let mean = b.coeff.iter().map(|c| c.abs()).sum::<f64>() / nm as f64;
            b.coeff.iter().map(|c| c / mean.max(1e-300)).collect()
        })
        .collect();

    let mut history = Vec::new();
    let mut converged = false;
    let mut iterations = 0;
    let mut eta = cfg.step;
    struct Prev {
        x: Vec<f64>,
        gx: Vec<f64>,
        j: f64,
        p: f64,
    }
    let mut prev: Option<Prev> = None;
    let mut last_p = f64::NAN;
    let mut lambdas = vec![0f64; cfg.budgets.len()];
    let mut rho_t_last = filter_all(&filter, &x, n, nm);

    for it in 0..cfg.max_iter {
        iterations = it + 1;
        let p = p_of(it);
        if p != last_p {
            prev = None;
            last_p = p;
        }
        let rho_t = filter_all(&filter, &x, n, nm);
        let ev = ctx.eval(&rho_t, p, cfg.risk_exponent, need_risk)?;
        if it == 0 {
            c0 = ev.compliance.max(1e-300);
            if need_risk {
                if ev.risk <= 0.0 {
                    return Err("risk requested but no material has a failure limit".into());
                }
                r0 = ev.risk;
            }
            for (k, (coeff, _)) in cfg.linear_terms.iter().enumerate() {
                l0[k] = lin_val(&rho_t, coeff).abs().max(1e-300);
            }
        }
        let j = objective(&ev, &rho_t, c0, r0, &l0);

        // gradient wrt the filtered shares, then back through the filter
        let mut g = vec![0f64; n * nm];
        for i in 0..n * nm {
            g[i] = cfg.w_compliance / c0 * ev.grad_c[i];
        }
        if need_risk {
            for i in 0..n * nm {
                g[i] += cfg.w_risk / r0 * ev.grad_r[i];
            }
        }
        for (k, (coeff, w)) in cfg.linear_terms.iter().enumerate() {
            for i in 0..n {
                for m in 0..nm {
                    g[i * nm + m] += w / l0[k] * coeff[m] * vol[i];
                }
            }
        }
        let gx = filter_all_t(&filter, &g, n, nm);

        // backtracking: if the objective rose at the same penalty, retreat
        let mut rejected = false;
        let (base_x, base_gx) = match &prev {
            Some(pr) if pr.p == p && j > pr.j * (1.0 + 1e-6) + 1e-12 && eta > 1e-3 => {
                rejected = true;
                eta *= 0.5;
                (pr.x.clone(), pr.gx.clone())
            }
            _ => {
                prev = Some(Prev { x: x.clone(), gx: gx.clone(), j, p });
                (x.clone(), gx.clone())
            }
        };

        // budget multipliers: coordinate bisection, filtered usage
        let try_x = |lams: &[f64]| update(&base_x, &base_gx, eta, lams, &cbar);
        let mut lam = if rejected { vec![0f64; lambdas.len()] } else { lambdas.clone() };
        for _sweep in 0..3 {
            for b in 0..cfg.budgets.len() {
                let usage_at = |l: f64, lam: &mut Vec<f64>| -> f64 {
                    lam[b] = l;
                    let xt = try_x(lam);
                    budget_usage(grid, &filter_all(&filter, &xt, n, nm), nm, &cfg.budgets[b].coeff)
                };
                if usage_at(0.0, &mut lam) <= cfg.budgets[b].max {
                    lam[b] = 0.0;
                    continue;
                }
                let (mut lo, mut hi) = (0.0, 1.0);
                while usage_at(hi, &mut lam) > cfg.budgets[b].max && hi < 1e4 {
                    lo = hi;
                    hi *= 2.0;
                }
                for _ in 0..50 {
                    let mid = 0.5 * (lo + hi);
                    if usage_at(mid, &mut lam) > cfg.budgets[b].max {
                        lo = mid;
                    } else {
                        hi = mid;
                    }
                }
                lam[b] = hi;
            }
        }
        lambdas = lam;
        let x_new = try_x(&lambdas);
        let mean_change = {
            let mut s = 0.0;
            for &i in &free {
                for m in 0..nm {
                    s += (x_new[i * nm + m] - x[i * nm + m]).abs();
                }
            }
            s / (free.len().max(1) * nm) as f64
        };
        history.push(MgIter {
            iteration: it + 1,
            penalty: p,
            objective: j,
            compliance: ev.compliance,
            risk: ev.risk,
            step: eta,
            mean_change,
            rejected,
        });
        rho_t_last = rho_t;
        x = x_new;
        if !progress(history.last().unwrap()) {
            break;
        }
        if !rejected && it >= final_start && mean_change < cfg.tol_mean_change {
            converged = true;
            break;
        }
    }

    // ---- binarize ----
    let shares = filter_all(&filter, &x, n, nm);
    let _ = rho_t_last;
    let mut map = start.clone();
    let mut gray = 0usize;
    for &i in &solid {
        if fixed[i] >= 0 {
            map.id[i] = fixed[i] as u8;
        } else {
            let (mut best, mut bv) = (0usize, -1.0);
            for m in 0..nm {
                if shares[i * nm + m] > bv {
                    bv = shares[i * nm + m];
                    best = m;
                }
            }
            map.id[i] = best as u8;
            gray += (bv < 0.9) as usize;
        }
    }
    // greedy budget repair on the binary design
    for _pass in 0..3 {
        let mut all_ok = true;
        for b in &cfg.budgets {
            let usage = |map: &MaterialMap| -> f64 {
                solid.iter().map(|&i| vol[i] * b.coeff[map.id[i] as usize]).sum()
            };
            let mut u = usage(&map);
            if u <= b.max + 1e-9 {
                continue;
            }
            all_ok = false;
            let mut cand: Vec<(f64, usize, usize)> = Vec::new(); // (regret, cell, new material)
            for &i in &free {
                let cur = map.id[i] as usize;
                for m in 0..nm {
                    if b.coeff[m] < b.coeff[cur] {
                        cand.push((shares[i * nm + cur] - shares[i * nm + m], i, m));
                    }
                }
            }
            cand.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
            let mut changed = vec![false; n];
            for (_, i, m) in cand {
                if u <= b.max + 1e-9 {
                    break;
                }
                if changed[i] {
                    continue;
                }
                let cur = map.id[i] as usize;
                u -= vol[i] * (b.coeff[cur] - b.coeff[m]);
                map.id[i] = m as u8;
                changed[i] = true;
            }
        }
        if all_ok {
            break;
        }
    }
    let metrics = evaluate_design_layered(grid, levels, problem, &map, &cfg.risk_mask, cfg.risk_exponent, base, cfg.layer_bond)?;
    let budget_usage_out = cfg
        .budgets
        .iter()
        .map(|b| (solid.iter().map(|&i| vol[i] * b.coeff[map.id[i] as usize]).sum::<f64>(), b.max))
        .collect();
    let continuous_risk = history.last().map_or(0.0, |h| h.risk);
    let continuous_compliance = history.last().map_or(0.0, |h| h.compliance);
    Ok(MgResult {
        map,
        shares,
        iterations,
        converged,
        history,
        gray_fraction: if free.is_empty() { 0.0 } else { gray as f64 / free.len() as f64 },
        continuous_risk,
        continuous_compliance,
        norm_c: c0,
        norm_r: r0,
        norm_l: l0.clone(),
        metrics,
        budget_usage: budget_usage_out,
    })
}


/// One candidate design considered by [`optimize_best_of`].
#[derive(Clone, Debug)]
pub struct Candidate {
    pub label: String,
    /// Weighted, normalized objective of the BINARY design (lower is better).
    pub objective: f64,
    pub feasible: bool,
    pub metrics: Metrics,
    pub map: MaterialMap,
}

#[derive(Clone, Debug)]
pub struct BestOf {
    /// The chosen design.
    pub best: Candidate,
    /// Every candidate with its score (optimizer starts and single-material
    /// designs), in evaluation order.
    pub candidates: Vec<Candidate>,
    /// Result of the uniform-start optimization (history, shares, gray share).
    pub primary: MgResult,
}

/// Run the optimizer from several starting points and keep the best BINARY
/// design, also considering every single-material design.
///
/// The problem is non-convex: a start decides which local optimum the run
/// reaches, and a relaxed optimum can be worse than a trivial design after
/// binarization (measured: a pure-risk run ended above "all soft material").
/// Ranking candidates by the objective of their binary designs, with the
/// normalizers of the first (uniform-start) run, makes the returned design
/// never worse than the best single-material design that satisfies the
/// budgets. `starts`: `false` = uniform start only; `true` = additionally one
/// start per material.
pub fn optimize_best_of(
    grid: &VoxelGrid,
    levels: usize,
    problem: &NodeProblem,
    start: &MaterialMap,
    cfg: &MgConfig,
    base: SolveSettings,
    starts: bool,
    progress: &mut dyn FnMut(&MgIter) -> bool,
) -> Result<BestOf, String> {
    let nm = start.table.len();
    let n = grid.cell_count();
    let primary = optimize_multi_material_with(grid, levels, problem, start, cfg, base, progress)?;
    let (c0, r0, l0) = (primary.norm_c, primary.norm_r, primary.norm_l.clone());
    let solid: Vec<usize> = (0..n).filter(|&i| grid.scale[i] > 0.0).collect();
    let vol: Vec<f64> = (0..n).map(|i| grid.scale[i].max(0.0) as f64).collect();
    let score = |label: String, map: MaterialMap, m: Metrics| -> Candidate {
        let mut j = cfg.w_compliance * m.compliance / c0;
        if cfg.w_risk != 0.0 {
            j += cfg.w_risk * m.risk_pnorm / r0;
        }
        for (k, (coeff, w)) in cfg.linear_terms.iter().enumerate() {
            let used: f64 = solid.iter().map(|&i| vol[i] * coeff[map.id[i] as usize]).sum();
            j += w * used / l0[k];
        }
        let feasible = cfg.budgets.iter().all(|b| {
            let u: f64 = solid.iter().map(|&i| vol[i] * b.coeff[map.id[i] as usize]).sum();
            u <= b.max + 1e-9
        });
        Candidate { label, objective: j, feasible, metrics: m, map }
    };
    let mut cands = vec![score("optimized (uniform start)".into(), primary.map.clone(), primary.metrics.clone())];
    if starts {
        for m in 0..nm {
            let mut c = cfg.clone();
            let mut init = vec![0.001; nm];
            init[m] = 1.0;
            c.init_share = init;
            let r = optimize_multi_material_with(grid, levels, problem, start, &c, base, &mut |_| true)?;
            cands.push(score(format!("optimized (start {})", start.table[m].name), r.map, r.metrics));
        }
    }
    for m in 0..nm {
        let mut map = start.clone();
        for &i in &solid {
            map.id[i] = m as u8;
        }
        let mt = evaluate_design_layered(grid, levels, problem, &map, &cfg.risk_mask, cfg.risk_exponent, base, cfg.layer_bond)?;
        cands.push(score(format!("all {}", start.table[m].name), map, mt));
    }
    let best = cands
        .iter()
        .filter(|c| c.feasible)
        .min_by(|a, b| a.objective.partial_cmp(&b.objective).unwrap_or(std::cmp::Ordering::Equal))
        .or_else(|| cands.first())
        .cloned()
        .unwrap();
    Ok(BestOf { best, candidates: cands, primary })
}
