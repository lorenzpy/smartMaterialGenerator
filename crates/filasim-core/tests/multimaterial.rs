// SPDX-License-Identifier: AGPL-3.0-only
// Multi-material fork, milestone M1 tests (fork-local).
use filasim_core::eps::grid_eps;
use filasim_core::materials::{MaterialError, MaterialMap, MaterialProps};
use filasim_core::simp::solve_with_eps;
use filasim_core::{pad_for_levels, NodeProblem, SolveSettings, VoxelGrid};

/// Solve a uniaxial bar: x=0 clamped, 100 N tributary-weighted tension at x=nx.
/// Returns the weighted mean end displacement ux (mm). nu = 0 so the answer is
/// analytic. `build` receives the PADDED grid and returns its material map.
fn bar_tip(
    nx: usize,
    ny: usize,
    nz: usize,
    build: &dyn Fn(&VoxelGrid) -> MaterialMap,
) -> (f64, usize) {
    let (grid, levels) = pad_for_levels(&VoxelGrid::solid_box(nx, ny, nz, 1.0), 5);
    let map = build(&grid);
    // Void the padding so only the real bar carries stiffness.
    let mut g = grid.clone();
    for cz in 0..g.nz {
        for cy in 0..g.ny {
            for cx in 0..g.nx {
                if cx >= nx || cy >= ny || cz >= nz {
                    g.scale[(cz * g.ny + cy) * g.nx + cx] = 0.0;
                }
            }
        }
    }
    let eps = map.eps(&g);
    let (mx, my) = (g.nx + 1, g.ny + 1);
    let node = |x: usize, y: usize, z: usize| ((z * my + y) * mx + x) as u32;
    let wt = |i: usize, n: usize| if i == 0 || i == n { 0.5 } else { 1.0 };
    let wsum = (ny * nz) as f64;
    let (mut fixed, mut forces) = (Vec::new(), Vec::new());
    for z in 0..=nz {
        for y in 0..=ny {
            fixed.push(node(0, y, z));
            forces.push((node(nx, y, z), [100.0 * wt(y, ny) * wt(z, nz) / wsum, 0.0, 0.0]));
        }
    }
    let problem = NodeProblem { fixed, springs: vec![], forces, rigid: vec![], prescribed: vec![] };
    let settings = SolveSettings { e0: map.e_ref(), nu: 0.0, tol: 1e-9, max_iter: 4000, ..Default::default() };
    let (sol, _) = solve_with_eps(&g, levels, &problem, &settings, eps).expect("solve");
    let mut ux = 0.0;
    for z in 0..=nz {
        for y in 0..=ny {
            ux += wt(y, ny) * wt(z, nz) * sol.u[3 * node(nx, y, z) as usize] as f64;
        }
    }
    (ux / wsum, sol.iterations)
}

#[test]
fn single_material_eps_is_bit_identical_to_grid_eps() {
    // Varied occupancies incl. void cells, so the EMIN/occupancy branch is exercised.
    let mut grid = VoxelGrid::solid_box(7, 5, 4, 0.8);
    for (i, s) in grid.scale.iter_mut().enumerate() {
        *s = match i % 5 {
            0 => 0.0,
            1 => 0.3,
            2 => 0.77,
            _ => 1.0,
        };
    }
    let map = MaterialMap::uniform(&grid, vec![MaterialProps::test_pla()], 0, 0);
    let a = grid_eps(&grid);
    let b = map.eps(&grid);
    assert_eq!(a.len(), b.len());
    for (x, y) in a.iter().zip(&b) {
        assert_eq!(x.to_bits(), y.to_bits());
    }
}

#[test]
fn series_bar_pla_tpu_matches_analytic() {
    let (nx, ny, nz) = (64usize, 8usize, 8usize);
    let table = vec![MaterialProps::test_pla(), MaterialProps::test_tpu()];
    let (e1, e2) = (table[0].e, table[1].e);
    let (u, iters) = bar_tip(nx, ny, nz, &|g| {
        let mut m = MaterialMap::uniform(g, table.clone(), 0, 0);
        // Second half of the bar: TPU.
        m.assign_halfspace(g, [-1.0, 0.0, 0.0], -(g.origin[0] + 32.0), 1);
        m
    });
    let area = (ny * nz) as f64;
    let ua = 100.0 * 32.0 / (e1 * area) + 100.0 * 32.0 / (e2 * area);
    let err = (u - ua).abs() / ua;
    println!("series PLA/TPU: FE {u:.6}  analytic {ua:.6}  err {:.4}%  iters {iters}", 100.0 * err);
    assert!(err < 1e-4, "series bar off by {:.4}%", 100.0 * err);
}

#[test]
fn series_bar_pla_asa_matches_analytic() {
    let (nx, ny, nz) = (64usize, 8usize, 8usize);
    let table = vec![MaterialProps::test_pla(), MaterialProps::test_asa()];
    let (e1, e2) = (table[0].e, table[1].e);
    let (u, _) = bar_tip(nx, ny, nz, &|g| {
        let mut m = MaterialMap::uniform(g, table.clone(), 0, 0);
        m.assign_halfspace(g, [-1.0, 0.0, 0.0], -(g.origin[0] + 32.0), 1);
        m
    });
    let area = (ny * nz) as f64;
    let ua = 100.0 * 32.0 / (e1 * area) + 100.0 * 32.0 / (e2 * area);
    assert!((u - ua).abs() / ua < 1e-4);
}

/// Parallel arrangement: the cross-section is a PLA/TPU/PLA sandwich (half TPU),
/// loaded through a stiff end plate that forces equal strain. Reference: rule
/// of mixtures E_eff = (E1+E2)/2 plus the (tiny) plate compliance. The plate
/// is not perfectly rigid and the interface carries shear lag, so a few percent
/// tolerance is expected; the test prints the actual deviation.
#[test]
fn parallel_bar_with_stiff_end_plate_follows_rule_of_mixtures() {
    let (bar, plate, ny, nz) = (48usize, 8usize, 8usize, 8usize);
    let nx = bar + plate;
    let mut table = vec![MaterialProps::test_pla(), MaterialProps::test_tpu()];
    table.push(MaterialProps::new("plate (test)", 105000.0, 0.0, 1.0));
    let (e1, e2, ep) = (table[0].e, table[1].e, table[2].e);
    let (u, iters) = bar_tip(nx, ny, nz, &|g| {
        let mut m = MaterialMap::uniform(g, table.clone(), 0, 0);
        // SYMMETRIC layup: TPU core 2 <= y <= 6 mm, PLA outer layers. The
        // stiffness centroid then coincides with the load line, so there is no
        // bending (an asymmetric half/half layup is eccentrically loaded and
        // bends, which a first draft of this test overlooked).
        m.assign_box(g, [-1e9, g.origin[1] + 2.0, -1e9], [1e9, g.origin[1] + 6.0, 1e9], 1);
        // Last `plate` cells in x: stiff plate over the whole cross-section.
        let x0 = g.origin[0] + bar as f64;
        m.assign_box(g, [x0, -1e9, -1e9], [1e9, 1e9, 1e9], 2);
        m
    });
    let area = (ny * nz) as f64;
    let e_eff = 0.5 * (e1 + e2);
    let ua = 100.0 * bar as f64 / (e_eff * area) + 100.0 * plate as f64 / (ep * area);
    let err = (u - ua) / ua;
    println!("parallel PLA/TPU + plate: FE {u:.6}  rule-of-mixtures {ua:.6}  dev {:+.3}%  iters {iters}", 100.0 * err);
    assert!(err.abs() < 0.05, "parallel bar deviates {:+.2}%", 100.0 * err);
}

#[test]
fn mass_and_volume_fractions() {
    let grid = VoxelGrid::solid_box(10, 4, 4, 1.0);
    let mut m = MaterialMap::uniform(&grid, vec![MaterialProps::test_pla(), MaterialProps::test_tpu()], 0, 0);
    // Right half (x > 5 mm) TPU.
    m.assign_halfspace(&grid, [-1.0, 0.0, 0.0], -(grid.origin[0] + 5.0), 1);
    let vf = m.volume_fractions(&grid);
    assert!((vf[0] - 0.5).abs() < 1e-12 && (vf[1] - 0.5).abs() < 1e-12);
    let mf = m.mass_fractions(&grid);
    let (d1, d2) = (1.24, 1.21);
    assert!((mf[0] - d1 / (d1 + d2)).abs() < 1e-12);
    assert!((mf.iter().sum::<f64>() - 1.0).abs() < 1e-12);
    // Absolute mass: 80 cells... 10*4*4/2 = 80 mm^3 each.
    let g = m.masses_g(&grid);
    assert!((g[0] - 80.0 * 1e-3 * 1.24).abs() < 1e-12);
}

#[test]
fn validation_rejects_bad_maps() {
    let grid = VoxelGrid::solid_box(3, 3, 3, 1.0);
    let mut m = MaterialMap::uniform(&grid, vec![MaterialProps::test_pla()], 0, 0);
    assert_eq!(m.validate(&grid), Ok(()));
    m.id[4] = 5;
    assert_eq!(m.validate(&grid), Err(MaterialError::UnknownId(5)));
    m.id[4] = 0;
    m.id.pop();
    assert!(matches!(m.validate(&grid), Err(MaterialError::LengthMismatch { .. })));
    let empty = MaterialMap { id: vec![], table: vec![], reference: 0 };
    assert_eq!(empty.validate(&grid), Err(MaterialError::EmptyTable));
    let bad = MaterialMap::uniform(&grid, vec![MaterialProps::new("x", 0.0, 0.3, 1.0)], 0, 0);
    assert_eq!(bad.validate(&grid), Err(MaterialError::NonPositiveModulus(0)));
}

// ============================== M1b: per-material Poisson ratio =============

use filasim_core::eps::EpsField;
use filasim_core::simp::solve_with_eps_cached;

fn padded_box(nx: usize, ny: usize, nz: usize) -> (VoxelGrid, usize) {
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
    (g, levels)
}

/// Cantilever: clamped x=0, tip force 20 N in -z (tributary weighted).
fn cantilever(g: &VoxelGrid, nx: usize, ny: usize, nz: usize) -> NodeProblem {
    let (mx, my) = (g.nx + 1, g.ny + 1);
    let node = |x: usize, y: usize, z: usize| ((z * my + y) * mx + x) as u32;
    let wt = |i: usize, n: usize| if i == 0 || i == n { 0.5 } else { 1.0 };
    let wsum = (ny * nz) as f64;
    let (mut fixed, mut forces) = (Vec::new(), Vec::new());
    for z in 0..=nz {
        for y in 0..=ny {
            fixed.push(node(0, y, z));
            forces.push((node(nx, y, z), [0.0, 0.0, -20.0 * wt(y, ny) * wt(z, nz) / wsum]));
        }
    }
    NodeProblem { fixed, springs: vec![], forces, rigid: vec![], prescribed: vec![] }
}

#[test]
fn overlay_path_equals_direct_isotropic_solve() {
    // Reference material PLA (nu .35); the WHOLE part is TPU (nu .45), so every
    // cell goes through the second-tensor path. The displacement field must
    // equal a plain isotropic solve with the TPU constants.
    let (nx, ny, nz) = (24usize, 6usize, 6usize);
    let (g, levels) = padded_box(nx, ny, nz);
    let problem = cantilever(&g, nx, ny, nz);
    let table = vec![MaterialProps::test_pla(), MaterialProps::test_tpu()];
    let map = MaterialMap::uniform(&g, table.clone(), 0, 1);
    let base = SolveSettings { tol: 1e-9, max_iter: 4000, ..Default::default() };
    let (field, settings) = map.solver_inputs(&g, base).unwrap();
    // Only TPU is used, so a single tensor (at TPU's nu) suffices.
    assert!(settings.ti.is_none() && field.infill.is_none());
    assert!((settings.nu - 0.45).abs() < 1e-12);
    let (a, _) = solve_with_eps_cached(&mut None, &g, levels, &problem, &settings, field).unwrap();

    let direct = SolveSettings { e0: table[1].e, nu: table[1].nu, ti: None, ..base };
    let eps = EpsField::from(grid_eps(&g));
    let (b, _) = solve_with_eps_cached(&mut None, &g, levels, &problem, &direct, eps).unwrap();
    let (mut num, mut den) = (0.0f64, 0.0f64);
    for (x, y) in a.u.iter().zip(&b.u) {
        num += ((*x - *y) as f64).powi(2);
        den += (*y as f64).powi(2);
    }
    let rel = (num / den).sqrt();
    println!("overlay vs direct (TPU-only cantilever): relative L2 difference {rel:.2e}");
    assert!(rel < 1e-4, "overlay path differs from direct solve: {rel:e}");
}

#[test]
fn laminate_in_uniaxial_strain_depends_on_poisson_ratio() {
    // Layers stacked along y, loaded along y with ux = uz = 0 everywhere
    // (penalty springs): each layer then has the constrained modulus
    // M = E(1-nu)/((1+nu)(1-2nu)) and the layers act in series.
    let (nx, ny, nz) = (6usize, 16usize, 6usize);
    let (g, levels) = padded_box(nx, ny, nz);
    let (mx, my) = (g.nx + 1, g.ny + 1);
    let node = |x: usize, y: usize, z: usize| ((z * my + y) * mx + x) as u32;
    let wt = |i: usize, n: usize| if i == 0 || i == n { 0.5 } else { 1.0 };
    let wsum = (nx * nz) as f64;
    let (mut fixed, mut springs, mut forces) = (Vec::new(), Vec::new(), Vec::new());
    let k = 1e7;
    for z in 0..=nz {
        for y in 0..=ny {
            for x in 0..=nx {
                let n = node(x, y, z);
                springs.push((n, [1.0, 0.0, 0.0], k));
                springs.push((n, [0.0, 0.0, 1.0], k));
                if y == 0 {
                    fixed.push(n);
                }
                if y == ny {
                    forces.push((n, [0.0, 100.0 * wt(x, nx) * wt(z, nz) / wsum, 0.0]));
                }
            }
        }
    }
    let problem = NodeProblem { fixed, springs, forces, rigid: vec![], prescribed: vec![] };

    let run = |nu_tpu: f64| -> f64 {
        let mut tpu = MaterialProps::test_tpu();
        tpu.nu = nu_tpu;
        let table = vec![MaterialProps::test_pla(), tpu];
        let mut map = MaterialMap::uniform(&g, table, 0, 0);
        map.assign_halfspace(&g, [0.0, -1.0, 0.0], -(g.origin[1] + 8.0), 1); // y >= 8: TPU
        let base = SolveSettings { tol: 1e-9, max_iter: 6000, ..Default::default() };
        let (field, settings) = map.solver_inputs(&g, base).unwrap();
        let (sol, _) = solve_with_eps_cached(&mut None, &g, levels, &problem, &settings, field).unwrap();
        let mut uy = 0.0;
        for z in 0..=nz {
            for x in 0..=nx {
                uy += wt(x, nx) * wt(z, nz) * sol.u[3 * node(x, ny, z) as usize + 1] as f64;
            }
        }
        uy / wsum
    };
    let m = |e: f64, nu: f64| e * (1.0 - nu) / ((1.0 + nu) * (1.0 - 2.0 * nu));
    let area = (nx * nz) as f64;
    let analytic = |nu_tpu: f64| 100.0 / area * (8.0 / m(3500.0, 0.35) + 8.0 / m(80.0, nu_tpu));

    let (u_same, u_diff) = (run(0.35), run(0.45));
    let (a_same, a_diff) = (analytic(0.35), analytic(0.45));
    println!(
        "laminate: nu_TPU=.35 FE {u_same:.6} / analytic {a_same:.6} ({:+.3}%)   nu_TPU=.45 FE {u_diff:.6} / analytic {a_diff:.6} ({:+.3}%)",
        100.0 * (u_same - a_same) / a_same,
        100.0 * (u_diff - a_diff) / a_diff
    );
    assert!(((u_same - a_same) / a_same).abs() < 0.01, "same-nu laminate off");
    assert!(((u_diff - a_diff) / a_diff).abs() < 0.01, "different-nu laminate off");
    // The two analytic answers differ by a lot, so agreement is only possible
    // when the second Poisson ratio genuinely reaches the solver.
    assert!((a_same - a_diff).abs() / a_diff > 0.3);
}

#[test]
fn single_poisson_ratio_uses_plain_path() {
    let g = VoxelGrid::solid_box(4, 4, 4, 1.0);
    let table = vec![MaterialProps::test_pla(), MaterialProps::new("same nu", 2000.0, 0.35, 1.1)];
    let mut map = MaterialMap::uniform(&g, table, 0, 0);
    map.id[3] = 1;
    let (field, s) = map.solver_inputs(&g, SolveSettings::default()).unwrap();
    assert!(s.ti.is_none() && field.infill.is_none());
}

// ============================== N materials, any Poisson ratio ==============

use filasim_core::materials::{lame, LameBasis};

#[test]
fn lame_basis_reproduces_every_isotropic_material_in_range() {
    let b = LameBasis::new(3500.0, 0.30, 0.47);
    let mut st = 99u64;
    for _ in 0..200 {
        let e = 10.0 + 4000.0 * lcg(&mut st);
        let nu = 0.30 + 0.17 * lcg(&mut st);
        let (l, m) = lame(e, nu);
        let (wa, wb) = b.weights(l, m);
        let (la, ma) = lame(3500.0, 0.30);
        let (lb, mb) = lame(3500.0, 0.47);
        assert!(wa >= 0.0 && wb >= 0.0);
        assert!((wa * la + wb * lb - l).abs() < 1e-9 * l.max(1.0));
        assert!((wa * ma + wb * mb - m).abs() < 1e-9 * m.max(1.0));
    }
}

#[test]
fn three_materials_three_poisson_ratios_laminate_matches_analytic() {
    // PLA (nu .35), ASA (nu .37) and TPU (nu .45), stacked along y in
    // uniaxial strain: each layer acts with its constrained modulus.
    let (nx, ny, nz) = (6usize, 18usize, 6usize);
    let (g, levels) = padded_box(nx, ny, nz);
    let (mx, my) = (g.nx + 1, g.ny + 1);
    let node = |x: usize, y: usize, z: usize| ((z * my + y) * mx + x) as u32;
    let wt = |i: usize, n: usize| if i == 0 || i == n { 0.5 } else { 1.0 };
    let wsum = (nx * nz) as f64;
    let (mut fixed, mut springs, mut forces) = (Vec::new(), Vec::new(), Vec::new());
    for z in 0..=nz {
        for y in 0..=ny {
            for x in 0..=nx {
                let n = node(x, y, z);
                springs.push((n, [1.0, 0.0, 0.0], 1e7));
                springs.push((n, [0.0, 0.0, 1.0], 1e7));
                if y == 0 {
                    fixed.push(n);
                }
                if y == ny {
                    forces.push((n, [0.0, 100.0 * wt(x, nx) * wt(z, nz) / wsum, 0.0]));
                }
            }
        }
    }
    let problem = NodeProblem { fixed, springs, forces, rigid: vec![], prescribed: vec![] };
    let table = vec![MaterialProps::test_pla(), MaterialProps::test_asa(), MaterialProps::test_tpu()];
    let mut map = MaterialMap::uniform(&g, table.clone(), 0, 0);
    map.assign_halfspace(&g, [0.0, -1.0, 0.0], -(g.origin[1] + 6.0), 1); // y >= 6: ASA
    map.assign_halfspace(&g, [0.0, -1.0, 0.0], -(g.origin[1] + 12.0), 2); // y >= 12: TPU
    let base = SolveSettings { tol: 1e-9, max_iter: 8000, ..Default::default() };
    let (field, settings) = map.solver_inputs(&g, base).unwrap();
    assert!(settings.ti.is_some());
    assert!((settings.nu - 0.35).abs() < 1e-12);
    let (sol, _) = solve_with_eps_cached(&mut None, &g, levels, &problem, &settings, field).unwrap();
    let mut uy = 0.0;
    for z in 0..=nz {
        for x in 0..=nx {
            uy += wt(x, nx) * wt(z, nz) * sol.u[3 * node(x, ny, z) as usize + 1] as f64;
        }
    }
    let uy = uy / wsum;
    let m = |mp: &MaterialProps| mp.e * (1.0 - mp.nu) / ((1.0 + mp.nu) * (1.0 - 2.0 * mp.nu));
    let area = (nx * nz) as f64;
    let analytic = 100.0 / area * table.iter().map(|mp| 6.0 / m(mp)).sum::<f64>();
    let dev = (uy - analytic) / analytic;
    println!("3-material laminate: FE {uy:.6}  analytic {analytic:.6}  dev {:+.4}%", 100.0 * dev);
    assert!(dev.abs() < 0.01);
}

#[test]
fn voigt_mixture_of_two_materials_equals_equivalent_isotropic_solve() {
    // Every cell: 50 % PLA + 50 % TPU as a Voigt mixture, expressed through
    // the Lame basis. A Voigt mix of isotropic tensors is isotropic with
    // lambda = mean, mu = mean, so it must equal a direct isotropic solve with
    // the equivalent (E, nu).
    let (nx, ny, nz) = (24usize, 6usize, 6usize);
    let (g, levels) = padded_box(nx, ny, nz);
    let problem = cantilever(&g, nx, ny, nz);
    let (pla, tpu) = (MaterialProps::test_pla(), MaterialProps::test_tpu());
    let (lp, mp) = lame(pla.e, pla.nu);
    let (lt, mt) = lame(tpu.e, tpu.nu);
    let (lm, mm) = (0.5 * (lp + lt), 0.5 * (mp + mt));
    let basis = LameBasis::new(pla.e, pla.nu, tpu.nu);
    let (wa, wb) = basis.weights(lm, mm);
    let n = g.cell_count();
    let (a, b): (Vec<f32>, Vec<f32>) = (0..n)
        .map(|i| if g.scale[i] > 0.0 { (wa as f32, wb as f32) } else { (0.0, 0.0) })
        .unzip();
    let base = SolveSettings { tol: 1e-9, max_iter: 4000, ..Default::default() };
    let settings = basis.settings(base);
    let (s1, _) = solve_with_eps_cached(&mut None, &g, levels, &problem, &settings, EpsField::ti(a, b)).unwrap();

    let e_eq = mm * (3.0 * lm + 2.0 * mm) / (lm + mm);
    let nu_eq = lm / (2.0 * (lm + mm));
    let direct = SolveSettings { e0: e_eq, nu: nu_eq, ti: None, ..base };
    let (s2, _) = solve_with_eps_cached(&mut None, &g, levels, &problem, &direct, EpsField::from(grid_eps(&g))).unwrap();
    let (mut num, mut den) = (0.0f64, 0.0f64);
    for (x, y) in s1.u.iter().zip(&s2.u) {
        num += ((*x - *y) as f64).powi(2);
        den += (*y as f64).powi(2);
    }
    let rel = (num / den).sqrt();
    println!("Voigt mixture via Lame basis vs equivalent isotropic: rel L2 {rel:.2e} (E_eq {e_eq:.1}, nu_eq {nu_eq:.3})");
    assert!(rel < 1e-4);
}

fn lcg(state: &mut u64) -> f64 {
    *state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    ((*state >> 33) as f64) / (1u64 << 31) as f64
}
