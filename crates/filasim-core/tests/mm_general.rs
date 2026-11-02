// SPDX-License-Identifier: AGPL-3.0-only
// Fork-local tests for the general N-material optimizer (mmgen).
use filasim_core::materials::{MaterialMap, MaterialProps};
use filasim_core::mmgen::{evaluate_design, optimize_best_of, optimize_multi_material, Budget, MgConfig, MgContext};
use filasim_core::{pad_for_levels, NodeProblem, SolveSettings, VoxelGrid};

struct Setup {
    grid: VoxelGrid,
    levels: usize,
    problem: NodeProblem,
    table: Vec<MaterialProps>,
    nx: usize,
}

/// Cantilever 'nx*ny*nz', clamped at x=0. `spring_k` = None: plain tip force
/// `force` (N, -z). Some(k): the load is applied through a device spring of
/// total stiffness k (N/mm) pulling the tip toward a target displacement
/// `target` (mm): F = k (target - u_tip), i.e. deformation-driven loading.
fn setup(nx: usize, ny: usize, nz: usize, force: f64, spring_k: Option<(f64, f64)>) -> Setup {
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
    let (mut fixed, mut forces, mut springs) = (Vec::new(), Vec::new(), Vec::new());
    for z in 0..=nz {
        for y in 0..=ny {
            fixed.push(node(0, y, z));
            let w = wt(y, ny) * wt(z, nz) / wsum;
            match spring_k {
                None => forces.push((node(nx, y, z), [0.0, 0.0, -force * w])),
                Some((k, target)) => {
                    springs.push((node(nx, y, z), [0.0, 0.0, 1.0], k * w));
                    forces.push((node(nx, y, z), [0.0, 0.0, -k * w * target]));
                }
            }
        }
    }
    Setup {
        grid: g,
        levels,
        problem: NodeProblem { fixed, springs, forces, rigid: vec![], prescribed: vec![] },
        table: vec![MaterialProps::test_pla(), MaterialProps::test_asa(), MaterialProps::test_tpu()],
        nx,
    }
}

fn lcg(state: &mut u64) -> f64 {
    *state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    ((*state >> 33) as f64) / (1u64 << 31) as f64
}

fn base() -> SolveSettings {
    SolveSettings { tol: 1e-8, max_iter: 6000, ..Default::default() }
}

fn ends_mask(s: &Setup) -> Vec<bool> {
    let g = &s.grid;
    (0..g.cell_count()).map(|i| g.scale[i] > 0.0 && (i % g.nx) >= 2 && (i % g.nx) < s.nx - 2).collect()
}

#[test]
fn gradients_with_adjoint_match_finite_differences_three_materials() {
    let s = setup(12, 4, 4, 30.0, None);
    let g = &s.grid;
    let start = MaterialMap::uniform(g, s.table.clone(), 0, 0);
    let b = SolveSettings { tol: 1e-13, max_iter: 30000, ..Default::default() };
    let mask = ends_mask(&s);
    let mut ctx = MgContext::new(g, s.levels, &s.problem, &start, &mask, b).unwrap();
    let (n, nm) = (g.cell_count(), 3);
    let mut st = 5u64;
    // random shares on the simplex
    let mut rho = vec![0.0; n * nm];
    for i in 0..n {
        if g.scale[i] > 0.0 {
            let r: Vec<f64> = (0..nm).map(|_| 0.15 + lcg(&mut st)).collect();
            let z: f64 = r.iter().sum();
            for m in 0..nm {
                rho[i * nm + m] = r[m] / z;
            }
        }
    }
    for &(p, q) in &[(1.0, 4.0), (2.0, 6.0), (3.0, 8.0)] {
        let ev = ctx.eval(&rho, p, q, true).unwrap();
        // choose entries with the largest |gradient| of each kind
        let mut idx: Vec<usize> = (0..n * nm).filter(|&k| g.scale[k / nm] > 0.0).collect();
        idx.sort_by(|&a, &b| ev.grad_r[b].abs().partial_cmp(&ev.grad_r[a].abs()).unwrap());
        let pick_r: Vec<usize> = idx.iter().take(6).copied().collect();
        idx.sort_by(|&a, &b| ev.grad_c[b].abs().partial_cmp(&ev.grad_c[a].abs()).unwrap());
        let pick_c: Vec<usize> = idx.iter().take(4).copied().collect();
        let (mut worst_c, mut worst_r) = (0f64, 0f64);
        for (&k, is_risk) in pick_c.iter().map(|k| (k, false)).chain(pick_r.iter().map(|k| (k, true))) {
            let d = 1e-5;
            let (mut rp, mut rm) = (rho.clone(), rho.clone());
            rp[k] += d;
            rm[k] -= d;
            let ep = ctx.eval(&rp, p, q, true).unwrap();
            let em = ctx.eval(&rm, p, q, true).unwrap();
            if is_risk {
                let fd = (ep.risk - em.risk) / (2.0 * d);
                let rel = (fd - ev.grad_r[k]).abs() / ev.grad_r[k].abs().max(1e-9);
                worst_r = worst_r.max(rel);
                println!("p={p} q={q}: risk  entry {k:4} analytic {:+.5e} fd {:+.5e} rel {:.1e}", ev.grad_r[k], fd, rel);
            } else {
                let fd = (ep.compliance - em.compliance) / (2.0 * d);
                let rel = (fd - ev.grad_c[k]).abs() / ev.grad_c[k].abs().max(1e-9);
                worst_c = worst_c.max(rel);
                println!("p={p} q={q}: compl entry {k:4} analytic {:+.5e} fd {:+.5e} rel {:.1e}", ev.grad_c[k], fd, rel);
            }
        }
        assert!(worst_c < 2e-3, "compliance gradient off: {worst_c:.1e}");
        assert!(worst_r < 5e-3, "risk gradient off: {worst_r:.1e}");
    }
}

#[test]
fn pure_stiffness_objective_picks_the_stiffest_material() {
    let s = setup(24, 6, 6, 40.0, None);
    let g = &s.grid;
    let start = MaterialMap::uniform(g, s.table.clone(), 0, 0);
    let mut cfg = MgConfig::new();
    cfg.w_risk = 0.0;
    cfg.max_iter = 120;
    let r = optimize_multi_material(g, s.levels, &s.problem, &start, &cfg, base()).unwrap();
    let solid = (0..g.cell_count()).filter(|&i| g.scale[i] > 0.0).count() as f64;
    println!("pure stiffness: iterations {} converged {} volume fractions {:?}", r.iterations, r.converged, r.metrics.volume_fractions);
    assert!(r.metrics.volume_fractions[0] > 0.97, "expected (almost) all PLA, got {:?}", r.metrics.volume_fractions);
    let _ = solid;
}

#[test]
fn budget_on_one_material_is_respected() {
    let s = setup(24, 6, 6, 40.0, None);
    let g = &s.grid;
    let start = MaterialMap::uniform(g, s.table.clone(), 0, 0);
    let total: f64 = (0..g.cell_count()).map(|i| g.scale[i].max(0.0) as f64).sum();
    let mut cfg = MgConfig::new();
    cfg.w_risk = 0.0;
    cfg.max_iter = 120;
    // At most 30 % PLA.
    cfg.budgets.push(Budget { coeff: vec![1.0, 0.0, 0.0], max: 0.30 * total });
    let r = optimize_multi_material(g, s.levels, &s.problem, &start, &cfg, base()).unwrap();
    println!("PLA<=30%: fractions {:?}, usage {:?}", r.metrics.volume_fractions, r.budget_usage);
    assert!(r.metrics.volume_fractions[0] <= 0.30 + 1e-9);
    // The stiffest remaining material (ASA) should take the rest, not TPU.
    assert!(r.metrics.volume_fractions[1] > r.metrics.volume_fractions[2]);
}

/// Deformation-driven loading: a device spring pulls the tip toward a target
/// displacement. Stiffer designs deflect less but see more force and stress;
/// softer designs deflect more but crack less. Sweeps the weights (slow, ~10
/// min: run with `--ignored`).
#[test]
#[ignore]
fn deformation_driven_tradeoff_sweep() {
    let (nx, ny, nz) = (32usize, 6usize, 6usize);
    // k, target: test values chosen so that all-PLA exceeds its limit.
    let s = setup(nx, ny, nz, 0.0, Some((20.0, 6.0)));
    let g = &s.grid;
    let n = g.cell_count();
    let start = MaterialMap::uniform(g, s.table.clone(), 0, 0);
    let mask = ends_mask(&s);
    let fixed: Vec<i16> = (0..n).map(|i| if g.scale[i] > 0.0 && ((i % g.nx) < 2 || (i % g.nx) >= nx - 2) { 0 } else { -1 }).collect();
    let q = 8.0;

    println!("\n{:26} {:>10} {:>9} {:>9} {:>8} {:>6}   volume fractions PLA/ASA/TPU", "design", "compliance", "max disp", "risk max", "risk_p", "fail");
    let mut rows: Vec<(String, f64, f64, f64)> = Vec::new();
    for m in 0..3u8 {
        let mut map = start.clone();
        for i in 0..n {
            if g.scale[i] > 0.0 {
                map.id[i] = m;
            }
        }
        let mt = evaluate_design(g, s.levels, &s.problem, &map, &mask, q, base()).unwrap();
        println!(
            "{:26} {:10.3} {:9.4} {:9.3} {:8.3} {:6}   {:?}",
            format!("all {}", s.table[m as usize].name), mt.compliance, mt.max_disp, mt.risk_max, mt.risk_pnorm, mt.failing_cells,
            mt.volume_fractions.iter().map(|v| (v * 100.0).round() / 100.0).collect::<Vec<_>>()
        );
        rows.push((format!("all {m}"), mt.compliance, mt.max_disp, mt.risk_pnorm));
    }
    let (c_pla, d_pla, r_pla) = (rows[0].1, rows[0].2, rows[0].3);
    let (_, d_tpu, r_tpu) = (rows[2].1, rows[2].2, rows[2].3);

    let mut results = Vec::new();
    for &(wc, wr) in &[(1.0, 0.0), (1.0, 1.0), (1.0, 4.0), (0.0, 1.0)] {
        let mut cfg = MgConfig::new();
        cfg.w_compliance = wc;
        cfg.w_risk = wr;
        cfg.risk_exponent = q;
        cfg.risk_mask = mask.clone();
        cfg.fixed_material = fixed.clone();
        cfg.max_iter = 200;
        let t0 = std::time::Instant::now();
        let r = optimize_multi_material(g, s.levels, &s.problem, &start, &cfg, base()).unwrap();
        let m = &r.metrics;
        println!(
            "{:26} {:10.3} {:9.4} {:9.3} {:8.3} {:6}   {:?}  [{} it, conv {}, {:.0}s, gray {:.0}%]",
            format!("optimized w_c={wc} w_r={wr}"), m.compliance, m.max_disp, m.risk_max, m.risk_pnorm, m.failing_cells,
            m.volume_fractions.iter().map(|v| (v * 100.0).round() / 100.0).collect::<Vec<_>>(),
            r.iterations, r.converged, t0.elapsed().as_secs_f64(), 100.0 * r.gray_fraction
        );
        results.push(((wc, wr), r));
    }
    let find = |w: (f64, f64)| &results.iter().find(|(k, _)| *k == w).unwrap().1.metrics;
    let stiff = find((1.0, 0.0));
    let soft = find((0.0, 1.0));
    // Endpoints behave as the physics says.
    assert!(stiff.max_disp <= d_pla * 1.02, "pure stiffness should deflect no more than all-PLA");
    assert!(soft.risk_pnorm < r_pla, "pure risk objective must beat all-PLA on risk");
    assert!(soft.max_disp > stiff.max_disp, "the risk end must be softer");
    let _ = (c_pla, d_tpu, r_tpu);
}


/// Why does the pure-risk run end worse than "all TPU"? Compares the relaxed
/// (continuous) risk with the binarized one and tries other starting shares.
#[test]
#[ignore]
fn pure_risk_diagnosis() {
    let (nx, ny, nz) = (32usize, 6usize, 6usize);
    let s = setup(nx, ny, nz, 0.0, Some((20.0, 6.0)));
    let g = &s.grid;
    let n = g.cell_count();
    let start = MaterialMap::uniform(g, s.table.clone(), 0, 0);
    let mask = ends_mask(&s);
    let fixed: Vec<i16> = (0..n).map(|i| if g.scale[i] > 0.0 && ((i % g.nx) < 2 || (i % g.nx) >= nx - 2) { 0 } else { -1 }).collect();
    println!("\n{:28} {:>6} {:>5} {:>6} {:>10} {:>10} {:>9} {:>9}  fractions", "start", "iters", "conv", "gray%", "risk cont", "risk bin", "disp bin", "s");
    for (name, init) in [
        ("uniform 1/3", vec![]),
        ("all TPU", vec![0.001, 0.001, 0.998]),
        ("all PLA", vec![0.998, 0.001, 0.001]),
    ] {
        let mut cfg = MgConfig::new();
        cfg.w_compliance = 0.0;
        cfg.w_risk = 1.0;
        cfg.risk_mask = mask.clone();
        cfg.fixed_material = fixed.clone();
        cfg.max_iter = 200;
        cfg.init_share = init;
        let t0 = std::time::Instant::now();
        let r = optimize_multi_material(g, s.levels, &s.problem, &start, &cfg, base()).unwrap();
        println!(
            "{name:28} {:6} {:>5} {:6.1} {:10.4} {:10.4} {:9.3} {:9.0}  {:?}",
            r.iterations, r.converged, 100.0 * r.gray_fraction, r.continuous_risk, r.metrics.risk_pnorm, r.metrics.max_disp, t0.elapsed().as_secs_f64(),
            r.metrics.volume_fractions.iter().map(|v| (v * 100.0).round() / 100.0).collect::<Vec<_>>()
        );
    }
    println!("(reference: all-TPU risk p-norm 0.134, max disp 5.82)");
}


/// The same deformation-driven sweep, but through `optimize_best_of` (several
/// starts + the single-material designs as candidates).
#[test]
#[ignore]
fn best_of_tradeoff_sweep() {
    let (nx, ny, nz) = (32usize, 6usize, 6usize);
    let s = setup(nx, ny, nz, 0.0, Some((20.0, 6.0)));
    let g = &s.grid;
    let n = g.cell_count();
    let start = MaterialMap::uniform(g, s.table.clone(), 0, 0);
    let mask = ends_mask(&s);
    let fixed: Vec<i16> = (0..n).map(|i| if g.scale[i] > 0.0 && ((i % g.nx) < 2 || (i % g.nx) >= nx - 2) { 0 } else { -1 }).collect();
    println!("\n{:>5} {:>5} | {:30} {:>9} {:>9} {:>9}  fractions PLA/ASA/TPU", "w_c", "w_r", "chosen", "max disp", "risk max", "risk_p");
    for &(wc, wr) in &[(1.0, 0.0), (1.0, 1.0), (1.0, 4.0), (1.0, 16.0), (0.0, 1.0)] {
        let mut cfg = MgConfig::new();
        cfg.w_compliance = wc;
        cfg.w_risk = wr;
        cfg.risk_mask = mask.clone();
        cfg.fixed_material = fixed.clone();
        cfg.max_iter = 200;
        let t0 = std::time::Instant::now();
        let r = optimize_best_of(g, s.levels, &s.problem, &start, &cfg, base(), wr > 0.0, &mut |_| true).unwrap();
        let m = &r.best.metrics;
        println!(
            "{wc:5} {wr:5} | {:30} {:9.3} {:9.3} {:9.3}  {:?}   [{:.0}s]",
            r.best.label, m.max_disp, m.risk_max, m.risk_pnorm,
            m.volume_fractions.iter().map(|v| (v * 100.0).round() / 100.0).collect::<Vec<_>>(), t0.elapsed().as_secs_f64()
        );
        for c in &r.candidates {
            println!("        candidate {:28} J {:7.4}  disp {:6.3}  risk_p {:6.3}  fractions {:?}", c.label, c.objective, c.metrics.max_disp, c.metrics.risk_pnorm,
                c.metrics.volume_fractions.iter().map(|v| (v * 100.0).round() / 100.0).collect::<Vec<_>>());
        }
        // The chosen design is never worse than any single-material design.
        for c in r.candidates.iter().filter(|c| c.label.starts_with("all ")) {
            assert!(r.best.objective <= c.objective + 1e-12);
        }
    }
}

/// What is attainable at all? Hand-built layered designs (PLA from the root up
/// to a fraction of the length, TPU beyond) on the deformation-driven case,
/// compared with the single-material designs. Shows whether mixed designs can
/// beat the endpoints, independent of any optimizer.
#[test]
#[ignore]
fn hand_built_mixed_designs() {
    let (nx, ny, nz) = (32usize, 6usize, 6usize);
    let s = setup(nx, ny, nz, 0.0, Some((20.0, 6.0)));
    let g = &s.grid;
    let n = g.cell_count();
    let start = MaterialMap::uniform(g, s.table.clone(), 0, 0);
    let mask = ends_mask(&s);
    let q = 8.0;
    println!("\n{:34} {:>9} {:>9} {:>9}", "design", "max disp", "risk max", "risk_p");
    let run = |name: &str, f: &dyn Fn(usize) -> u8| {
        let mut map = start.clone();
        for i in 0..n {
            if g.scale[i] > 0.0 {
                map.id[i] = f(i);
            }
        }
        let m = evaluate_design(g, s.levels, &s.problem, &map, &mask, q, base()).unwrap();
        println!("{name:34} {:9.3} {:9.3} {:9.3}", m.max_disp, m.risk_max, m.risk_pnorm);
        (m.max_disp, m.risk_pnorm)
    };
    let (d_pla, r_pla) = run("all PLA", &|_| 0);
    let (d_tpu, r_tpu) = run("all TPU", &|_| 2);
    for frac in [0.25f64, 0.5, 0.75] {
        let cut = (frac * nx as f64) as usize;
        let (d, r) = run(&format!("PLA root {:.0}% / TPU tip", 100.0 * frac), &|i| if (i % g.nx) < cut { 0 } else { 2 });
        let line = r_pla + (r_tpu - r_pla) * (d - d_pla) / (d_tpu - d_pla);
        println!("    straight line PLA-TPU at this deflection: risk_p {line:.3}  -> mixed is {}", if r < line { "BELOW (better)" } else { "above (worse)" });
    }
    for frac in [0.25f64, 0.5, 0.75] {
        let cut = (frac * nx as f64) as usize;
        let (d, r) = run(&format!("TPU root {:.0}% / PLA tip", 100.0 * frac), &|i| if (i % g.nx) < cut { 2 } else { 0 });
        let line = r_pla + (r_tpu - r_pla) * (d - d_pla) / (d_tpu - d_pla);
        println!("    straight line PLA-TPU at this deflection: risk_p {line:.3}  -> mixed is {}", if r < line { "BELOW (better)" } else { "above (worse)" });
    }
}

/// Imposed deformation: a very stiff device spring forces the tip to a target
/// displacement, so the strain is set by the geometry. Hand-built designs:
/// all PLA, all TPU, and a PLA arm with a TPU hinge at the root.
#[test]
#[ignore]
fn imposed_deformation_hinge() {
    let (nx, ny, nz) = (32usize, 6usize, 6usize);
    let (k, target) = (2000.0, 2.5);
    let s = setup(nx, ny, nz, 0.0, Some((k, target)));
    let g = &s.grid;
    let n = g.cell_count();
    let start = MaterialMap::uniform(g, s.table.clone(), 0, 0);
    let mask = ends_mask(&s);
    println!("\ntip target {target} mm, device spring {k} N/mm\n{:30} {:>8} {:>9} {:>9} {:>9} {:>9}", "design", "tip mm", "force N", "risk max", "risk_p", "fail");
    let cases: Vec<(&str, Option<usize>)> = vec![("all PLA", None), ("all TPU", Some(nx)), ("TPU hinge 4 cells", Some(4)), ("TPU hinge 8 cells", Some(8)), ("TPU hinge 12 cells", Some(12))];
    for (name, hinge) in cases {
        let mut map = start.clone();
        for i in 0..n {
            if g.scale[i] > 0.0 {
                map.id[i] = match hinge {
                    None => 0,
                    Some(c) => if (i % g.nx) < c { 2 } else { 0 },
                };
            }
        }
        let m = evaluate_design(g, s.levels, &s.problem, &map, &mask, 8.0, base()).unwrap();
        let u_tip = m.compliance / (k * target);
        let force = k * (target - u_tip);
        println!("{name:30} {:8.3} {:9.2} {:9.3} {:9.3} {:9}", u_tip, force, m.risk_max, m.risk_pnorm, m.failing_cells);
    }
}
