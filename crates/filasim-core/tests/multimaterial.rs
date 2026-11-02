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
