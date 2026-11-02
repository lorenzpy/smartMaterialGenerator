// SPDX-License-Identifier: AGPL-3.0-only
// Fork-local tests for the two-material optimizer (milestone M4).
use filasim_core::materials::{MaterialMap, MaterialProps};
use filasim_core::mmopt::{optimize_two_material, MmConfig, MmContext};
use filasim_core::simp::solve_with_eps_cached;
use filasim_core::threshold::{assign_by_threshold, cell_fields, ThresholdConfig};
use filasim_core::{pad_for_levels, NodeProblem, SolveSettings, VoxelGrid};

// TEST VALUES, not measured data.
const PLA_STRESS_ALLOW: f64 = 50.0;
const TPU_STRAIN_ALLOW: f64 = 0.20;

struct Setup {
    grid: VoxelGrid,
    levels: usize,
    problem: NodeProblem,
    table: Vec<MaterialProps>,
    nx: usize,
    nz: usize,
}

fn setup(nx: usize, ny: usize, nz: usize, force: f64) -> Setup {
    let (mut g, levels) = pad_for_levels(&VoxelGrid::solid_box(nx, ny, nz, 1.0), 5);
    for cz in 0..g.nz {
        for cy in 0..g.ny {
            for cx in 0..g.nx {
                if cx >= nx || cy >= ny || cz >= nz {
                    g.scale[(cz * g.ny + cy) * g.nx + cx] = 0.0;
                }
            }
        }
    }
    let (mx, my) = (g.nx + 1, g.ny + 1);
    let node = |x: usize, y: usize, z: usize| ((z * my + y) * mx + x) as u32;
    let wt = |i: usize, n: usize| if i == 0 || i == n { 0.5 } else { 1.0 };
    let wsum = (ny * nz) as f64;
    let (mut fixed, mut forces) = (Vec::new(), Vec::new());
    for z in 0..=nz {
        for y in 0..=ny {
            fixed.push(node(0, y, z));
            forces.push((node(nx, y, z), [0.0, 0.0, -force * wt(y, ny) * wt(z, nz) / wsum]));
        }
    }
    Setup {
        grid: g,
        levels,
        problem: NodeProblem { fixed, springs: vec![], forces, rigid: vec![], prescribed: vec![] },
        table: vec![MaterialProps::test_pla(), MaterialProps::test_tpu()],
        nx,
        nz,
    }
}

fn base() -> SolveSettings {
    SolveSettings { tol: 1e-8, max_iter: 6000, ..Default::default() }
}

/// Independent compliance of a binary map through MaterialMap::solver_inputs.
fn solve_map(s: &Setup, map: &MaterialMap) -> Result<(Vec<f32>, f64), String> {
    let (field, settings) = map.solver_inputs(&s.grid, base()).map_err(|e| format!("{e:?}"))?;
    let (sol, c) = solve_with_eps_cached(&mut None, &s.grid, s.levels, &s.problem, &settings, field)
        .map_err(|e| format!("{e}"))?;
    Ok((sol.u, c))
}

fn lcg(state: &mut u64) -> f64 {
    *state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    ((*state >> 33) as f64) / (1u64 << 31) as f64
}

fn frozen_ends(s: &Setup) -> Vec<bool> {
    let g = &s.grid;
    (0..g.cell_count()).map(|i| g.scale[i] > 0.0 && ((i % g.nx) < 2 || (i % g.nx) >= s.nx - 2)).collect()
}

#[test]
fn sensitivity_matches_finite_differences() {
    let s = setup(12, 4, 4, 30.0);
    let g = &s.grid;
    let start = MaterialMap::uniform(g, s.table.clone(), 0, 0);
    let b = SolveSettings { tol: 1e-13, max_iter: 20000, ..Default::default() };
    let mut ctx = MmContext::new(g, s.levels, &s.problem, &start, 0, 1, b).unwrap();
    let n = g.cell_count();
    let mut st = 7u64;
    let rho: Vec<f64> = (0..n).map(|i| if g.scale[i] > 0.0 { 0.25 + 0.6 * lcg(&mut st) } else { 0.0 }).collect();
    for &p in &[1.0, 2.0, 3.0] {
        let (_, dc) = ctx.eval(&rho, p).unwrap();
        // Pick the cells with the largest |sensitivity| (clear signal).
        let mut idx: Vec<usize> = (0..n).filter(|&i| g.scale[i] > 0.0).collect();
        idx.sort_by(|&a, &b| dc[b].abs().partial_cmp(&dc[a].abs()).unwrap());
        let mut worst = 0f64;
        for &i in idx.iter().take(6).chain(idx.iter().rev().take(3)) {
            let d = 1e-4;
            let (mut rp, mut rm) = (rho.clone(), rho.clone());
            rp[i] += d;
            rm[i] -= d;
            let cp = ctx.eval(&rp, p).unwrap().0;
            let cm = ctx.eval(&rm, p).unwrap().0;
            let fd = (cp - cm) / (2.0 * d);
            let rel = (fd - dc[i]).abs() / dc[i].abs().max(1e-9);
            worst = worst.max(rel);
            println!("p={p}: cell {i:4}  analytic {:+.6e}  finite diff {:+.6e}  rel {:.2e}", dc[i], fd, rel);
        }
        assert!(worst < 5e-3, "p={p}: worst relative sensitivity error {worst:.2e}");
    }
}

#[test]
fn cantilever_optimizer_vs_rule_random_and_pla() {
    let s = setup(48, 8, 8, 60.0);
    let g = &s.grid;
    let n = g.cell_count();
    let frozen = frozen_ends(&s);
    let start = MaterialMap::uniform(g, s.table.clone(), 0, 0);

    // Optimizer, stiff share <= 50 %.
    let mut cfg = MmConfig::new(0, 1);
    cfg.max_stiff_volume_fraction = Some(0.5);
    cfg.frozen_stiff = frozen.clone();
    let res = optimize_two_material(g, s.levels, &s.problem, &start, &cfg, base()).expect("optimize");
    println!(
        "\noptimizer: iters {} converged {} gray {:.1}%  S_max {:.1}  stiff vol {:.3}  mass {:.2} g",
        res.iterations, res.converged, 100.0 * res.gray_fraction, res.s_max, res.stiff_volume_fraction, res.mass_g
    );
    for h in res.history.iter().step_by(10) {
        println!("  it {:3}  p {:.1}  compliance {:9.4}  change {:.4}", h.iteration, h.penalty, h.compliance, h.change);
    }

    // Allowable-based rule with the same cap.
    let tcfg = ThresholdConfig {
        stiff: 0,
        soft: 1,
        stiff_stress_allow: PLA_STRESS_ALLOW,
        soft_strain_allow: TPU_STRAIN_ALLOW,
        safety: 1.0,
        max_soft_volume_fraction: Some(0.5),
        max_iter: 40,
        flip_fraction: 0.3,
        frozen_stiff: frozen.clone(),
    };
    let rule = assign_by_threshold(g, &start, &tcfg, &mut |m| solve_map(&s, m)).unwrap();

    // Random with the same stiff share (frozen stay stiff).
    let solid: Vec<usize> = (0..n).filter(|&i| g.scale[i] > 0.0).collect();
    let mut rnd = start.clone();
    for &i in &solid {
        rnd.id[i] = 1;
    }
    let mut free: Vec<usize> = solid.iter().copied().filter(|&i| !frozen[i]).collect();
    let mut st = 12345u64;
    for i in (1..free.len()).rev() {
        let j = (lcg(&mut st) * (i + 1) as f64) as usize % (i + 1);
        free.swap(i, j);
    }
    let mut used = 0.0;
    for &i in &solid {
        if frozen[i] {
            rnd.id[i] = 0;
            used += 1.0;
        }
    }
    for &i in &free {
        if used + 1.0 > res.s_max + 1e-9 {
            break;
        }
        rnd.id[i] = 0;
        used += 1.0;
    }

    let report = |name: &str, m: &MaterialMap| -> (f64, f64, f64) {
        let (u, c) = solve_map(&s, m).unwrap();
        let f = cell_fields(g, &u, m);
        let (mut sf_p, mut sf_t) = (f64::INFINITY, f64::INFINITY);
        for &i in &solid {
            if m.id[i] == 1 {
                sf_t = sf_t.min(TPU_STRAIN_ALLOW / (f.eq_strain[i] as f64).max(1e-30));
            } else {
                sf_p = sf_p.min(PLA_STRESS_ALLOW / (f.vm[i] as f64).max(1e-30));
            }
        }
        println!(
            "{name:34} compliance {c:9.3}  stiff vol {:5.1}%  mass {:6.2} g  SF_PLA {sf_p:6.2}  SF_TPU {sf_t:6.2}",
            100.0 * m.volume_fractions(g)[0],
            m.masses_g(g).iter().sum::<f64>()
        );
        (c, sf_p, sf_t)
    };
    let all_pla = report("all PLA (baseline)", &start);
    let c_rule = report("allowable rule", &rule.map).0;
    let c_rnd = report("random, same stiff share", &rnd).0;
    let c_opt = report("optimizer (binarized)", &res.map).0;
    println!(
        "optimizer vs verification solve: continuous {:.3}  binary (independent path) {:.3}",
        res.compliance_continuous, res.compliance_binary
    );
    assert!((res.compliance_binary - c_opt).abs() / c_opt < 1e-4);
    println!("optimizer / rule = {:.3}   optimizer / random = {:.3}   optimizer / PLA = {:.3}", c_opt / c_rule, c_opt / c_rnd, c_opt / all_pla.0);

    // With the default (mean-change) criterion the run now converges.
    assert!(res.converged, "default configuration should converge within max_iter");
    // Budget honored exactly (to one cell).
    assert!(res.stiff_volume_fraction <= 0.5 + 1e-9);
    assert!(res.stiff_volume_fraction > 0.5 - 2.0 / solid.len() as f64);
    // Must beat chance clearly.
    assert!(c_opt < 0.5 * c_rnd, "optimizer should clearly beat random placement");

    // Material goes where bending needs it: stiff cells lie farther from the
    // neutral plane (z = nz/2) than soft cells.
    let zc = s.nz as f64 / 2.0;
    let dist = |sel: u8| {
        let v: Vec<f64> = solid
            .iter()
            .filter(|&&i| res.map.id[i] == sel && !frozen[i])
            .map(|&i| ((i / (g.nx * g.ny)) as f64 + 0.5 - zc).abs())
            .collect();
        v.iter().sum::<f64>() / v.len() as f64
    };
    println!("mean distance from neutral plane: stiff {:.2} cells, soft {:.2} cells", dist(0), dist(1));
    assert!(dist(0) > dist(1));
}

#[test]
fn budget_variants() {
    let s = setup(24, 6, 6, 40.0);
    let g = &s.grid;
    let start = MaterialMap::uniform(g, s.table.clone(), 0, 0);
    let frozen = frozen_ends(&s);
    let solid_n = (0..g.cell_count()).filter(|&i| g.scale[i] > 0.0).count() as f64;

    // Mass cap: choose a cap between all-TPU and all-PLA mass.
    let cell_g = 1e-3; // 1 mm³ cell in cm³
    let (d_s, d_t) = (s.table[0].density, s.table[1].density);
    let m_all_pla = solid_n * cell_g * d_s;
    let m_all_tpu = solid_n * cell_g * d_t;
    let cap = m_all_tpu + 0.4 * (m_all_pla - m_all_tpu);
    let mut cfg = MmConfig::new(0, 1);
    cfg.max_mass_g = Some(cap);
    cfg.frozen_stiff = frozen.clone();
    cfg.max_iter = 80;
    let r = optimize_two_material(g, s.levels, &s.problem, &start, &cfg, base()).unwrap();
    println!("mass cap {cap:.4} g -> mass {:.4} g, stiff vol {:.3}", r.mass_g, r.stiff_volume_fraction);
    assert!(r.mass_g <= cap + 1e-9);
    assert!((r.stiff_volume_fraction - 0.4).abs() < 0.02);

    // Both budgets: the tighter one wins.
    let mut cfg2 = cfg.clone();
    cfg2.max_stiff_volume_fraction = Some(0.25);
    let r2 = optimize_two_material(g, s.levels, &s.problem, &start, &cfg2, base()).unwrap();
    println!("both budgets (mass ~40 %, fraction 25 %) -> stiff vol {:.3}", r2.stiff_volume_fraction);
    assert!(r2.stiff_volume_fraction <= 0.25 + 1e-9);

    // Full budget: everything stiff, compliance equals all-PLA.
    let mut cfg3 = MmConfig::new(0, 1);
    cfg3.max_stiff_volume_fraction = Some(1.0);
    cfg3.max_iter = 30;
    let r3 = optimize_two_material(g, s.levels, &s.problem, &start, &cfg3, base()).unwrap();
    let c_pla = solve_map(&s, &start).unwrap().1;
    println!("budget 100 %: compliance {:.4} vs all-PLA {:.4}", r3.compliance_binary, c_pla);
    assert!((r3.compliance_binary - c_pla).abs() / c_pla < 1e-6);

    // Invalid input is rejected.
    assert!(optimize_two_material(g, s.levels, &s.problem, &start, &MmConfig::new(0, 1), base()).is_err());
    let mut wrong = MmConfig::new(0, 1);
    wrong.max_stiff_volume_fraction = Some(0.5);
    let mut swapped = start.clone();
    swapped.reference = 1;
    assert!(optimize_two_material(g, s.levels, &s.problem, &swapped, &wrong, base()).is_err());
}

#[test]
fn strength_prior_keeps_highly_stressed_cells_stiff() {
    let s = setup(48, 8, 8, 60.0);
    let g = &s.grid;
    let start = MaterialMap::uniform(g, s.table.clone(), 0, 0);
    let sigma_c = s.table[1].e * TPU_STRAIN_ALLOW; // 16 MPa
    let mut cfg = MmConfig::new(0, 1);
    cfg.max_stiff_volume_fraction = Some(0.5);
    cfg.frozen_stiff = frozen_ends(&s);
    cfg.keep_stiff_above_stress = Some(sigma_c);
    let r = optimize_two_material(g, s.levels, &s.problem, &start, &cfg, base()).unwrap();

    // All frozen cells must be stiff in the result.
    let (u, _) = solve_map(&s, &{
        let mut m = start.clone();
        for i in 0..g.cell_count() {
            if g.scale[i] > 0.0 {
                m.id[i] = 0;
            }
        }
        m
    })
    .unwrap();
    let f0 = cell_fields(g, &u, &start);
    let high: Vec<usize> = (0..g.cell_count()).filter(|&i| g.scale[i] > 0.0 && (f0.vm[i] as f64) > sigma_c).collect();
    let soft_among_high = high.iter().filter(|&&i| r.map.id[i] == 1).count();
    println!("cells above {sigma_c:.1} MPa in all-PLA: {} ; of them soft in result: {soft_among_high}; frozen {}", high.len(), r.frozen_cells);
    assert_eq!(soft_among_high, 0);
    assert!(r.frozen_cells >= high.len());

    // Final strength check of the resulting design.
    let (uu, c) = solve_map(&s, &r.map).unwrap();
    let f = cell_fields(g, &uu, &r.map);
    let (mut sf_p, mut sf_t) = (f64::INFINITY, f64::INFINITY);
    for i in 0..g.cell_count() {
        if g.scale[i] <= 0.0 {
            continue;
        }
        if r.map.id[i] == 1 {
            sf_t = sf_t.min(TPU_STRAIN_ALLOW / (f.eq_strain[i] as f64).max(1e-30));
        } else {
            sf_p = sf_p.min(PLA_STRESS_ALLOW / (f.vm[i] as f64).max(1e-30));
        }
    }
    println!("with strength prior: compliance {c:.3}  SF_PLA {sf_p:.2}  SF_TPU {sf_t:.2}");
}

/// Longer / stronger-penalty runs to see how much the 150-iteration result
/// depends on the schedule. Slow; run with `--ignored`.
#[test]
#[ignore]
fn schedule_sensitivity() {
    let s = setup(48, 8, 8, 60.0);
    let g = &s.grid;
    let start = MaterialMap::uniform(g, s.table.clone(), 0, 0);
    let frozen = frozen_ends(&s);
    println!("\n{:>5} {:>4} {:>6} {:>8} {:>6} {:>5} {:>9} {:>9}", "maxit", "p1", "filter", "iters", "conv", "gray%", "C_cont", "C_binary");
    for (max_iter, p_end, ips, radius) in [(150usize, 3.0, 12usize, 1.5f64), (400, 3.0, 20, 1.5), (400, 4.0, 20, 1.5), (400, 4.0, 20, 1.0), (400, 4.0, 20, 2.0)] {
        let mut cfg = MmConfig::new(0, 1);
        cfg.max_stiff_volume_fraction = Some(0.5);
        cfg.frozen_stiff = frozen.clone();
        cfg.max_iter = max_iter;
        cfg.converge_on_mean = false;
        cfg.tol_change = 0.01;
        cfg.penalty_end = p_end;
        cfg.iters_per_penalty = ips;
        cfg.filter_radius_cells = radius;
        let r = optimize_two_material(g, s.levels, &s.problem, &start, &cfg, base()).unwrap();
        println!(
            "{max_iter:5} {p_end:4.1} {radius:6.1} {:8} {:>6} {:5.1} {:9.3} {:9.3}",
            r.iterations, r.converged, 100.0 * r.gray_fraction, r.compliance_continuous, r.compliance_binary
        );
    }
}

/// Where does the missing convergence come from? Prints the iteration trace
/// of the default run and compares remedies. Slow; run with `--ignored`.
#[test]
#[ignore]
fn convergence_diagnosis() {
    let s = setup(48, 8, 8, 60.0);
    let g = &s.grid;
    let start = MaterialMap::uniform(g, s.table.clone(), 0, 0);
    let frozen = frozen_ends(&s);
    let mk = |max_iter: usize| {
        let mut cfg = MmConfig::new(0, 1);
        cfg.max_stiff_volume_fraction = Some(0.5);
        cfg.frozen_stiff = frozen.clone();
        cfg.max_iter = max_iter;
        // The diagnosis reproduces the ORIGINAL criterion (max |dx| < 0.01).
        cfg.converge_on_mean = false;
        cfg.tol_change = 0.01;
        cfg
    };

    let r = optimize_two_material(g, s.levels, &s.problem, &start, &mk(150), base()).unwrap();
    println!("\nDEFAULT run (150 it, penalty ramps 1->3 in steps of 0.5 every 12 it; final phase from it 72)");
    println!("{:>4} {:>4} {:>10} {:>8} {:>8} {:>9} {:>7} {:>9}", "it", "p", "compliance", "max|dx|", "mean|dx|", "2-cycle", "moving", "mv in gray");
    for h in r.history.iter().filter(|h| h.iteration % 6 == 0 || h.iteration <= 3) {
        println!(
            "{:4} {:4.1} {:10.3} {:8.4} {:8.5} {:9.4} {:7} {:9}",
            h.iteration, h.penalty, h.compliance, h.change, h.mean_change, h.two_cycle, h.n_moving, h.n_moving_gray
        );
    }
    let tail: Vec<_> = r.history.iter().skip(100).collect();
    let n = tail.len() as f64;
    println!(
        "last 50 it: mean max|dx| {:.4}, mean mean|dx| {:.5}, mean 2-cycle {:.4}, mean moving {:.1} cells (of which gray {:.1})",
        tail.iter().map(|h| h.change).sum::<f64>() / n,
        tail.iter().map(|h| h.mean_change).sum::<f64>() / n,
        tail.iter().map(|h| h.two_cycle).sum::<f64>() / n,
        tail.iter().map(|h| h.n_moving as f64).sum::<f64>() / n,
        tail.iter().map(|h| h.n_moving_gray as f64).sum::<f64>() / n
    );
    let c_tail: Vec<f64> = r.history.iter().skip(100).map(|h| h.compliance).collect();
    let (cmin, cmax) = (c_tail.iter().cloned().fold(f64::INFINITY, f64::min), c_tail.iter().cloned().fold(0.0, f64::max));
    println!("compliance over its 101-150: min {cmin:.3} max {cmax:.3} (spread {:.2}%)", 100.0 * (cmax - cmin) / cmin);

    println!("\nREMEDIES (filter radius 1.5, tol 0.01 on the stated measure)");
    println!("{:34} {:>6} {:>5} {:>6} {:>5} {:>9}", "variant", "iters", "conv", "gray%", "", "C_binary");
    let variants: Vec<(&str, Box<dyn Fn(&mut MmConfig)>)> = vec![
        ("original (max|dx|)", Box::new(|_c| {})),
        ("mean|dx| criterion (tol 0.01)", Box::new(|c| c.converge_on_mean = true)),
        ("damping from it 12", Box::new(|c| c.damping_start = Some(12))),
        ("move-limit decay", Box::new(|c| c.move_limit_decay = true)),
        ("damping + decay", Box::new(|c| { c.damping_start = Some(12); c.move_limit_decay = true; })),
        ("damping + decay + mean criterion", Box::new(|c| { c.damping_start = Some(12); c.move_limit_decay = true; c.converge_on_mean = true; })),
    ];
    for (name, f) in &variants {
        let mut cfg = mk(300);
        f(&mut cfg);
        let r = optimize_two_material(g, s.levels, &s.problem, &start, &cfg, base()).unwrap();
        let last = r.history.last().unwrap();
        println!(
            "{name:34} {:6} {:>5} {:6.1} {:>5} {:9.3}   (last: max {:.4} mean {:.5} 2cyc {:.4})",
            r.iterations, r.converged, 100.0 * r.gray_fraction, "", r.compliance_binary, last.change, last.mean_change, last.two_cycle
        );
    }
}

/// Is the gray a filter effect, and which tolerance suits the mean criterion?
#[test]
#[ignore]
fn gray_and_tolerance_check() {
    let s = setup(48, 8, 8, 60.0);
    let g = &s.grid;
    let start = MaterialMap::uniform(g, s.table.clone(), 0, 0);
    let frozen = frozen_ends(&s);
    println!("\n{:30} {:>6} {:>5} {:>9} {:>9} {:>9}", "variant", "iters", "conv", "gray rho~", "gray x", "C_binary");
    let runs: Vec<(&str, f64, bool, f64)> = vec![
        ("r=1.5 max<0.01", 1.5, false, 0.01),
        ("r=1.5 mean<1e-3", 1.5, true, 1e-3),
        ("r=1.5 mean<2e-4", 1.5, true, 2e-4),
        ("r=1.0 max<0.01", 1.0, false, 0.01),
    ];
    for (name, radius, mean, tol) in runs {
        let mut cfg = MmConfig::new(0, 1);
        cfg.max_stiff_volume_fraction = Some(0.5);
        cfg.frozen_stiff = frozen.clone();
        cfg.max_iter = 300;
        cfg.filter_radius_cells = radius;
        cfg.converge_on_mean = mean;
        cfg.tol_change = tol;
        let r = optimize_two_material(g, s.levels, &s.problem, &start, &cfg, base()).unwrap();
        println!(
            "{name:30} {:6} {:>5} {:8.1}% {:8.1}% {:9.3}",
            r.iterations, r.converged, 100.0 * r.gray_fraction, 100.0 * r.gray_fraction_design, r.compliance_binary
        );
    }
}
