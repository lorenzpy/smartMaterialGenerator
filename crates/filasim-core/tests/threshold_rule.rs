// SPDX-License-Identifier: AGPL-3.0-only
// Fork-local: allowable-based assignment (PLA stiff / TPU soft) vs baselines.
use filasim_core::materials::{MaterialMap, MaterialProps};
use filasim_core::simp::solve_with_eps_cached;
use filasim_core::threshold::{assign_by_threshold, cell_fields, ThresholdConfig};
use filasim_core::{pad_for_levels, NodeProblem, SolveSettings, VoxelGrid};

// TEST VALUES, not measured data.
const PLA_STRESS_ALLOW: f64 = 50.0; // MPa
const TPU_STRAIN_ALLOW: f64 = 0.20; // 20 %

struct Setup {
    grid: VoxelGrid,
    levels: usize,
    problem: NodeProblem,
    table: Vec<MaterialProps>,
    nx: usize,
}

fn setup(force: f64) -> Setup {
    let (nx, ny, nz) = (48usize, 8usize, 8usize);
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
    }
}

fn solve(s: &Setup, map: &MaterialMap) -> Result<(Vec<f32>, f64), String> {
    let base = SolveSettings { tol: 1e-8, max_iter: 6000, ..Default::default() };
    let (field, settings) = map.solver_inputs(&s.grid, base).map_err(|e| format!("{e:?}"))?;
    let (sol, c) = solve_with_eps_cached(&mut None, &s.grid, s.levels, &s.problem, &settings, field)
        .map_err(|e| format!("{e}"))?;
    Ok((sol.u, c))
}

struct Row {
    name: String,
    compliance: f64,
    soft_vol: f64,
    soft_mass: f64,
    sf_stiff: f64,
    sf_soft: f64,
}

fn evaluate(s: &Setup, name: &str, map: &MaterialMap) -> Row {
    let (u, c) = solve(s, map).expect("solve");
    let f = cell_fields(&s.grid, &u, map);
    let (mut sf_stiff, mut sf_soft) = (f64::INFINITY, f64::INFINITY);
    for i in 0..s.grid.cell_count() {
        if s.grid.scale[i] <= 0.0 {
            continue;
        }
        if map.id[i] == 1 {
            sf_soft = sf_soft.min(TPU_STRAIN_ALLOW / (f.eq_strain[i] as f64).max(1e-30));
        } else {
            sf_stiff = sf_stiff.min(PLA_STRESS_ALLOW / (f.vm[i] as f64).max(1e-30));
        }
    }
    Row {
        name: name.to_string(),
        compliance: c,
        soft_vol: map.volume_fractions(&s.grid)[1],
        soft_mass: map.mass_fractions(&s.grid)[1],
        sf_stiff,
        sf_soft,
    }
}

/// Deterministic LCG, no external crates.
fn lcg(state: &mut u64) -> f64 {
    *state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    ((*state >> 33) as f64) / (1u64 << 31) as f64
}

#[test]
fn rule_vs_baselines_on_cantilever() {
    let s = setup(60.0);
    let g = &s.grid;
    let n = g.cell_count();
    let frozen: Vec<bool> = (0..n)
        .map(|i| {
            let cx = i % g.nx;
            cx < 2 || cx >= s.nx - 2
        })
        .collect();
    let start = MaterialMap::uniform(g, s.table.clone(), 0, 0);
    let cfg = ThresholdConfig {
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
    let out = assign_by_threshold(g, &start, &cfg, &mut |m| solve(&s, m)).expect("rule");
    println!("\niterations {} converged {}", out.iterations, out.converged);
    for h in &out.history {
        println!(
            "  it {:2}: +{:4} soft, -{:3} reverted, soft vol {:.3}, compliance {:.4}",
            h.iteration, h.flipped_to_soft, h.reverted, h.soft_volume_fraction, h.compliance
        );
    }

    // Baselines at the same soft volume fraction.
    let solid: Vec<usize> = (0..n).filter(|&i| g.scale[i] > 0.0).collect();
    let target = out.soft_volume_fraction;
    let total: f64 = solid.iter().map(|&i| g.scale[i] as f64).sum();
    let k = (target * total).round() as usize;
    let free: Vec<usize> = solid.iter().copied().filter(|&i| !frozen[i]).collect();

    // random
    let mut rnd = start.clone();
    let mut order = free.clone();
    let mut st = 12345u64;
    for i in (1..order.len()).rev() {
        let j = (lcg(&mut st) * (i + 1) as f64) as usize % (i + 1);
        order.swap(i, j);
    }
    for &i in order.iter().take(k) {
        rnd.id[i] = 1;
    }
    // inverse rule: soft where the all-stiff stress is HIGHEST
    let (u0, _) = solve(&s, &start).unwrap();
    let f0 = cell_fields(g, &u0, &start);
    let mut by_stress = free.clone();
    by_stress.sort_by(|&a, &b| f0.vm[b].partial_cmp(&f0.vm[a]).unwrap());
    let mut inv = start.clone();
    for &i in by_stress.iter().take(k) {
        inv.id[i] = 1;
    }
    // all soft
    let mut all_soft = start.clone();
    for &i in &solid {
        all_soft.id[i] = 1;
    }

    let rows = vec![
        evaluate(&s, "all PLA (baseline)", &start),
        evaluate(&s, "all TPU", &all_soft),
        evaluate(&s, "rule (allowable-based)", &out.map),
        evaluate(&s, "random, same TPU share", &rnd),
        evaluate(&s, "inverse rule (TPU at high stress)", &inv),
    ];
    let c0 = rows[0].compliance;
    println!("\n{:36} {:>10} {:>9} {:>8} {:>8} {:>9} {:>9}", "design", "compliance", "vs PLA", "TPU vol", "TPU mass", "SF PLA", "SF TPU");
    for r in &rows {
        println!(
            "{:36} {:10.4} {:8.2}x {:7.1}% {:7.1}% {:9.2} {:9.2}",
            r.name, r.compliance, r.compliance / c0, 100.0 * r.soft_vol, 100.0 * r.soft_mass, r.sf_stiff, r.sf_soft
        );
    }

    assert!(out.soft_volume_fraction <= 0.5 + 1e-9);
    assert!(out.converged, "rule did not converge within max_iter");
    assert!(rows[2].compliance < rows[3].compliance, "rule should beat random placement");
    assert!(rows[2].compliance < rows[4].compliance, "rule should beat the inverse rule");
}

#[test]
fn uncapped_rule_reports_what_the_limits_allow() {
    for force in [30.0, 60.0, 120.0] {
        let s = setup(force);
        let g = &s.grid;
        let frozen: Vec<bool> = (0..g.cell_count()).map(|i| (i % g.nx) < 2 || (i % g.nx) >= s.nx - 2).collect();
        let start = MaterialMap::uniform(g, s.table.clone(), 0, 0);
        let cfg = ThresholdConfig {
            stiff: 0,
            soft: 1,
            stiff_stress_allow: PLA_STRESS_ALLOW,
            soft_strain_allow: TPU_STRAIN_ALLOW,
            safety: 1.0,
            max_soft_volume_fraction: None,
            max_iter: 60,
            flip_fraction: 0.3,
            frozen_stiff: frozen,
        };
        let out = assign_by_threshold(g, &start, &cfg, &mut |m| solve(&s, m)).expect("rule");
        let all_pla = solve(&s, &start).unwrap().1;
        println!(
            "F={force:5.0} N: iters {:2} converged {} TPU vol {:5.1}%  compliance {:.2}x PLA  SF_PLA {:.2}  SF_TPU {:.2}  violating cells {}",
            out.iterations, out.converged, 100.0 * out.soft_volume_fraction, out.compliance / all_pla,
            out.sf_stiff_min, out.sf_soft_min, out.violating_cells
        );
        assert!(out.converged);
    }
}
