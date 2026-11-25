/* tslint:disable */
/* eslint-disable */

export class Model {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Make a previously stashed result the live solution (for displacement +
     * stress/strain queries) and return its per-soup-vertex displacements so
     * the viewport can re-deform without a second round-trip.
     */
    activate_result(id: string): Float32Array;
    /**
     * Bearing load (N): radial force on a cylindrical bore, cosine-distributed
     * over the loaded half (Ansys-style). Axial component is rejected.
     */
    add_bearing(tris: Uint32Array, fx: number, fy: number, fz: number): void;
    /**
     * Cylindrical support: lock any subset of the LOCAL cylinder directions of
     * a cylindrical selection — radial / tangential / axial (Ansys-style). The
     * selection is fitted to a cylinder; each locked direction gets stiff
     * penalty springs per node. Radial+axial with tangential free = a journal
     * bearing (the part can still turn about the axis).
     */
    add_cylindrical(tris: Uint32Array, radial: boolean, tangential: boolean, axial: boolean): void;
    /**
     * Displacement support: prescribe the selected global axes (x/y/z) to a
     * value in mm (0 = pin to zero), leaving the unselected ones free.
     */
    add_displacement(tris: Uint32Array, fx: boolean, fy: boolean, fz: boolean, vx: number, vy: number, vz: number): void;
    /**
     * Elastic ("soft") support: Winkler foundation, bedding modulus k in
     * N/mm³ (surface pressure per unit displacement, σ = k·u).
     */
    add_elastic(tris: Uint32Array, k: number): void;
    add_fixed(tris: Uint32Array): void;
    add_force(tris: Uint32Array, fx: number, fy: number, fz: number): void;
    add_frictionless(tris: Uint32Array): void;
    /**
     * Snapshot the CURRENT `bcs` (+ the active acceleration `set_bcs` resolved
     * for this step) as a weighted load case for the multi-load optimizer. Call
     * after `set_bcs`/`add_*` have populated this step's BCs. The accel snapshot
     * lets the optimizer recompute each case's design-dependent self-weight
     * (DESIGN §16 dec. 4).
     */
    add_load_case(weight: number): void;
    /**
     * Remote point mass (DESIGN §16): a component of `mass` TONNE with its CG at
     * world `(px,py,pz)` mm, bolted to the selected patch. `rigid` picks the
     * mount: DEFORMABLE (false) loads the patch with F = m·a + the transported
     * couple (p − c) × F, adding no stiffness; RIGID (true, milestone 4) also
     * stiffens the patch by tying it to a 6-DOF master at the CG (the load then
     * distributes by the rigidity kinematics). Inert (load-wise) with no accel;
     * the rigid stiffness is present regardless.
     */
    add_mass(tris: Uint32Array, px: number, py: number, pz: number, mass: number, rigid: boolean): void;
    /**
     * Moment (N·mm): deformable distributed couple over the selection.
     */
    add_moment(tris: Uint32Array, mx: number, my: number, mz: number): void;
    add_pressure(tris: Uint32Array, mpa: number): void;
    /**
     * [lox, loy, loz, hix, hiy, hiz] in mm.
     */
    bbox(): Float64Array;
    /**
     * Disconnected solid bodies in the working mesh (cavity shells and debris
     * don't count). UI warns when > 1 — the solver can't join separate bodies.
     */
    body_count(): number;
    /**
     * Island + rigid-body-mode check. JSON CheckReport.
     */
    check(): string;
    clear_bcs(): void;
    /**
     * Drop all registered multi-load optimization cases (DESIGN §13). The front
     * end calls this before EACH optimize, then `add_load_case` per included
     * step (none ⇒ single-load).
     */
    clear_load_cases(): void;
    /**
     * Drop every stashed result (geometry/grid change — all are stale and the
     * node grid they sample no longer matches the part).
     */
    clear_results(): void;
    /**
     * **Criterion of the LIVE solution** (DESIGN §17 dec. 4 + §20 dec. 5):
     * SF_crit and where it binds, computed from whatever result is currently
     * active — no solve, no re-assembly, nothing invalidated. This is how the
     * Settings Optimizer verifies its delivery after the standard As-Printed
     * run: the number comes from the SAME field the user is looking at.
     * JSON `{ sf, excludedCells, scoredCells, worst: {x, y, z, sf} | null }`.
     */
    criterion_sf(measure: string): string;
    /**
     * Isosurface of the final continuous density field at `threshold`
     * (0..1): everything denser than the threshold. Returns
     * [positions f32, indices u32, per-vertex density f32] for the
     * cutaway view (colored with the density legend ramp).
     */
    density_isosurface(threshold: number): Array<any>;
    /**
     * Project 3MF with part + modifiers for the chosen slicer flavor:
     * "orca" (default), "bambu", or "prusa". The part mesh is the ORIGINAL
     * import tessellation (display subdivision stays internal); the part
     * carries the perimeter count the optimization assumed. Bambu Studio
     * (>= 2.06) renamed the "rectilinear" pattern value to "zig-zag"
     * (still displayed as Rectilinear), so the bambu flavor maps it —
     * otherwise every project load pops a "values replaced" dialog.
     * `thumbnail` are PNG bytes for the plate preview (empty = embedded
     * placeholder). Only the Orca/Bambu flavor carries a plate thumbnail.
     */
    export_3mf(slicer: string, thumbnail: Uint8Array): Uint8Array;
    /**
     * Standalone colored 3MF of the active result field, painted into
     * `steps` discrete bands on the ORIGINAL undeformed surface. The field
     * `kind` matches `result_field` (the on-screen field); `lo`/`hi` are the
     * active contour min/max; `colors_json` is a JSON array of `#RRGGBB`
     * strings (one per band, low value first) the caller sampled from the
     * contour ramp. Each display triangle is CUT along the field's iso-lines at
     * the band boundaries (`isoband_cut`), so every emitted sub-triangle lies
     * wholly inside one band — razor-sharp, watertight transitions instead of
     * the streaky whole-triangle banding. Each piece is painted with its band's
     * filament (Bambu/Orca `paint_color`); N filaments in the embedded
     * `project_settings.config` carry the colors. No infill modifiers.
     */
    export_color_3mf(kind: string, lo: number, hi: number, steps: number, colors_json: string, thumbnail: Uint8Array): Uint8Array;
    /**
     * Slicer project 3MF with NO modifier volumes — just the part, placed on
     * the plate in the orientation the analysis ran in and carrying the walls,
     * shells and infill the analysis assumed. This is the hand-off for the runs
     * that have no modifier geometry to ship: a plain as-printed analysis, and
     * Part Topo (`optimized` swaps the imported part for the kept-material
     * body). Same flavors as `export_3mf`; `base_density` is a fraction.
     */
    export_positioned_3mf(slicer: string, thumbnail: Uint8Array, base_density: number, wall_loops: number, top_bottom_layers: number, optimized: boolean): Uint8Array;
    /**
     * Assemble a `.filasim` project zip: the original model bytes, the JS-built
     * manifest (settings + BCs + result roster), the compact optimized design,
     * and — when `include_results` — every stashed result's displacement + eps.
     */
    export_project(model_bytes: Uint8Array, model_entry: string, manifest: string, include_results: boolean): Uint8Array;
    /**
     * SOLID topology mode: the single optimized body as one binary STL (the
     * regions hold exactly one kept-material mesh). Re-sliceable / re-CAD-able.
     */
    export_solid_stl(): Uint8Array;
    /**
     * Zip of one binary STL per modifier region.
     */
    export_stls(): Uint8Array;
    /**
     * **Discretization uncertainty of a result field** — the number that says
     * how much to believe the peak.
     *
     * A voxel stress peak is read off the cells the staircase runs through,
     * and that maximum is not a convergent quantity on its own: measured on
     * the Kirsch plate it scattered −26…+30 % over a 1000× cell-count range
     * with no trend. `stress::recover_surface` fixes the ESTIMATE by fitting
     * the clean interior instead, but the honest thing to ship alongside it is
     * how far the two disagree — which is exactly how much staircase is in the
     * answer, and it costs nothing because both fields already exist.
     *
     * Returns JSON: `peak` (recovered — mesh-stable, the one to compare
     * between designs), `bound` (un-recovered — the conservative figure, and
     * by construction never below what the app reported before surface
     * recovery existed), `band` = their relative gap, `quality` of
     * `"resolved"` / `"marginal"` / `"unresolved"`, and `at` (the peak's
     * location). A verdict should be taken from `bound`; a design comparison
     * from `peak`; and when `quality` is `"unresolved"` neither is a number —
     * the mesh does not see the feature and the answer is to refine.
     */
    field_uncertainty(kind: string): string;
    /**
     * Fit a triangle selection to a cylinder and return the result as JSON:
     * `{ok, axis:[3], point:[3], radius, residual}`. `ok` is true only when the
     * cylindricity residual is within tolerance — the front end uses it to
     * accept/reject a bearing-load selection and to draw the axis glyph.
     */
    fit_cylinder(tris: Uint32Array): string;
    /**
     * Pre-tessellated import (DESIGN §18): meshStep runs in a JS import
     * worker and hands over an indexed mesh (mm, welded) with per-triangle
     * CAD-face and solid ids. Both id arrays must be DENSE indices — the JS
     * side densifies the STEP entity record numbers and keeps the dense→
     * entity-id tables for persistence, so `cad_segmentation`'s max+1 patch
     * sizing stays bounded by the real face count. Refinement + segmentation
     * are identical to the bytes path with CAD faces present.
     */
    static from_mesh(positions: Float32Array, indices: Uint32Array, face_of_tri: Uint32Array, solid_of_tri: Uint32Array, name: string): Model;
    /**
     * True when this model was imported from STEP and exact BREP faces are
     * available as a surface-patch source.
     */
    has_cad_faces(): boolean;
    /**
     * Inherent-strain preview on the analysis grid: the voxel hull of solid
     * cells UP TO build layer `layer_max` (exclusive in Z), with a per-vertex
     * scalar = the per-element inherent-strain SOURCE strength,
     * `eps_cell · |σ₀_in-plane|` (MPa) where σ₀ = D:ε₀ is the eigenstress of the
     * uniform shrink `[εxy, εxy, εz]`. Because the eigenstrain is uniform, the
     * per-cell variation is the density (skin = full, infill = its ratio) — so
     * this doubles as a layer-by-layer view of WHERE and HOW STRONGLY the build
     * sim pulls. Returns `[hull f32 (9/tri), normValue f32 (3/tri, 0..1 for the
     * ramp), edges f32, maxValueMPa f64, nz u32]`.
     */
    inherent_strain_voxels(layer_max: number, shrink_xy: number, shrink_z: number): Array<any>;
    /**
     * Per-vertex layer-adhesion SF for ONE build direction `n = (a, b, c)` —
     * the preview recolor when a heatmap pixel is clicked. Folds the same
     * result set as `orientation_sweep_begin` (elementwise min across load
     * steps), sampled to the display surface exactly like `result_field`
     * (smooth or per-cell). NOT ring-masked — the smoothed STL surface
     * hides nothing (greying happens on the per-cell voxel hull, below).
     */
    layer_sf_field(a: number, b: number, c: number, ids: Array<any>): Float32Array;
    /**
     * Voxel-hull variant of `layer_sf_field`: one value per hull vertex
     * (the owning cell's — crisp per-cell, like `voxel_result_field`).
     * Constraint-ring cells (excluded from the sweep SCORE, §15 dec. 3)
     * return NaN — the viewer paints them flat GREY, so the voxel view
     * shows exactly which cells the score ignores.
     */
    layer_sf_voxel_field(a: number, b: number, c: number, ids: Array<any>): Float32Array;
    /**
     * Number of mesh objects found in the imported file (UI warns when >1).
     */
    mesh_object_count(): number;
    mm_region_count(): number;
    mm_region_indices(i: number): Uint32Array;
    mm_region_material(i: number): number;
    mm_region_positions(i: number): Float32Array;
    /**
     * Run the general multi-material optimizer on the current setup
     * (supports + loads from the normal boundary conditions). Returns JSON
     * with the metrics of the optimized design and of every single-material
     * baseline; region meshes are fetched with `mm_region_*`.
     * `progress` is called as `progress(jsonString)` once per iteration.
     */
    mm_run(opts_json: string, progress: Function): string;
    /**
     * Constrained undamped modal analysis (`filasim_core::modal`): the lowest
     * `num_modes` natural frequencies + mode shapes of the part as supported by
     * the CURRENT `bcs` (the store sets these to the first load case before the
     * call). Force-free — applied forces/pressures are ignored; only supports
     * constrain the eigenproblem. Remote point masses (DESIGN §16) DO count:
     * each adds its translational inertia to the mass matrix on its attachment
     * patch, so a heavy payload lowers the frequencies (the offset's rotatory
     * inertia is not representable on a translational-DOF mesh — see
     * `point_mass_lumping`). Each mode shape is stashed as a result keyed `modal::mode-i`
     * (mass-normalized, then rescaled to unit peak for display), and mode 0 is
     * left live. JSON: `{ converged, outerIters, modes: [{id, freqHz}] }`. The
     * store builds one `ResultEntry` per mode from this and switches modes via
     * `activate_result`, reusing the deformed-view + animation path.
     */
    modal_analysis(opts_json: string, on_progress: Function): string;
    /**
     * Parse STL (binary/ASCII) or 3MF (zip magic); segment at 10° (fine
     * patches pick better; the slider re-segments live). STEP loads through
     * `from_mesh` — tessellated JS-side by meshStep (DESIGN §18).
     */
    constructor(bytes: Uint8Array, name: string);
    /**
     * Run the density optimization + binning + verification. `opts_json`
     * is an OptimizeOpts object; budgetPct is the target mean INFILL
     * density of the interior in percent — the number a user compares to a
     * slicer's uniform infill setting (the solid skin is on top of it).
     * Progress gets
     * called per iteration with (jsonString, Float32Array vertexDensity,
     * Float32Array skeletonPositions, Uint32Array skeletonIndices) — the
     * skeleton is the evolving isosurface of cells denser than 40%.
     * The perimeter count is also written into the
     * exported 3MF as the PART's wall_loops (modifiers never pin walls), so
     * the print matches the analysis assumption.
     */
    optimize(opts_json: string, progress: Function): string;
    orientation_sweep_begin(ids: Array<any>, step_deg: number): string;
    /**
     * Drop the sweep context built by `orientation_sweep_begin`.
     */
    orientation_sweep_end(): void;
    /**
     * Sweep pixels `[start, start+count)` of the flattened grid started by
     * `orientation_sweep_begin`. Returns `[scored, all]` — two Float32Arrays
     * of min layer-adhesion SF per pixel: `scored` excludes the constraint
     * ring, `all` hides nothing; both capped at SF_CAP. Chunk the calls so
     * the worker can post progress between them.
     */
    orientation_sweep_rows(start: number, count: number): Array<any>;
    /**
     * ORIGINAL (as-imported) tessellation as a triangle soup, 9 floats per
     * triangle. It follows every `transform` like the working mesh, but is
     * NOT display-refined — the refinement is non-conforming (T-junctions),
     * so viewport edge detection must run on THIS mesh (a T-junction edge
     * has no exact partner and either paints noise or hides real creases).
     */
    original_positions(): Float32Array;
    patch_count(): number;
    /**
     * Patch id per triangle.
     */
    patch_ids(): Uint32Array;
    /**
     * Bed-peel risk as a per-mesh-vertex scalar (3 per display triangle, same
     * layout as `result_field`), sampled from the last build sim's bed
     * reactions. `kind`: "peel" = upward lift (+Z, the peel driver), "peelshear"
     * = in-plane bed shear magnitude. Each vertex takes the reaction at its
     * nearest footprint node, ramped to zero over the first layers so the risk
     * reads at the base. Traction in MPa, uncalibrated (a RELATIVE indicator).
     * Errors if no build sim has been run.
     */
    peel_field(kind: string): Float32Array;
    /**
     * Bed-peel as a flat heatmap sitting ON the build plate: a triangle soup
     * covering the part's FOOTPRINT (bottom-layer solid cells of the coarse
     * build grid) at z = bed, plus a per-vertex value (lift or shear). Lets the
     * risk be read from a normal top/iso view instead of from under the part.
     * Returns `[positions Float32Array (9/tri), values Float32Array (3/tri)]`.
     */
    peel_map(kind: string): Array<any>;
    /**
     * Triangle soup positions, 9 floats per triangle (three.js non-indexed).
     */
    positions(): Float32Array;
    /**
     * Support reaction forces + moments of the current ANALYSIS solution:
     * a JSON array with one entry per current BC, in `bcs` order — `null`
     * for loads, else `{ force:[N;3], moment:[N·mm;3], centroid:[mm;3],
     * nodes }`. Sign convention: the force the support exerts ON the part,
     * so summed over all supports it balances the applied loads. Fixed
     * supports recover `R = K·u − f` with the eps/TI blend the solve used;
     * penalty supports report their exact spring force (see
     * `filasim_core::reaction`). Build-sim solutions live on a coarser grid
     * and are rejected. Self-weight at fixed-patch nodes uses the occupancy
     * vfrac — exact for solid solves; for graded-infill solves the (small)
     * difference only shifts the self-weight share of the cells touching a
     * fixed patch.
     */
    reaction_forces(): string;
    /**
     * ORIGINAL (as-imported) triangle index per working-mesh triangle — the
     * display-refinement parent map (identity when no refinement ran). The
     * exact display→source identity assembly bookkeeping needs; JS must not
     * reconstruct it geometrically (the refinement's triangle order is an
     * implementation detail no walk should depend on).
     */
    refinement_parents(): Uint32Array;
    region_count(): number;
    region_density(i: number): number;
    region_indices(i: number): Uint32Array;
    region_positions(i: number): Float32Array;
    /**
     * Re-run segmentation with a different crease angle (degrees). Switches the
     * surface patches back to dihedral region-growing (away from CAD faces).
     */
    resegment(angle_deg: number): void;
    /**
     * Re-apply constrained smoothing to the extracted regions (live preview
     * of the smoothing slider). Affects display AND subsequent exports.
     */
    resmooth_regions(iters: number): void;
    /**
     * Rebuild `self.opt` (+ the optimized stress eps) from a saved design blob.
     * Settings (material/resolution/snap/composite) and the orientation must be
     * applied first so the grid + cell classification match the saved run.
     */
    restore_optimization(blob: Uint8Array): void;
    /**
     * Read design.bin + results/*.f32 out of a project zip and restore them.
     * The model + its settings/orientation must already be set up. Returns JSON
     * { restoredResults: [...ids], hasDesign }.
     */
    restore_project(project_bytes: Uint8Array): string;
    /**
     * Inject a saved result's displacement (+eps) into the stash so the Results
     * view can show/switch to it without re-solving. The grid must already be
     * built (restore the design, or ensure the grid, first).
     */
    restore_result(id: string, blob: Uint8Array): void;
    /**
     * Stress/strain scalar per soup vertex, from the current solution.
     * Kinds: "vm" | "sxx" | "syy" | "szz" | "sxy" | "syz" | "szx" |
     * "s1" | "s2" | "s3" (principal stresses, descending — MPa),
     * "evm" | "exx" | "eyy" | "ezz" | "gxy" | "gyz" | "gzx" (strain), and
     * "sf" — safety factor σ_allow/σ_vM, where the allowable of graded
     * infill scales with the SAME relative factor as its stiffness
     * (Gibson–Ashby strength tracks stiffness to first order; the skin
     * carries the full tensile strength). Capped at `SF_CAP`.
     * Evaluated at cell centers with the eps the solve actually used.
     * With smooth_stress on, the per-cell field is recovered to the nodes
     * (volume-averaged) and interpolated AT the surface vertex — the
     * boundary cells' staircase noise averages out instead of being copied
     * onto the surface.
     */
    result_field(kind: string): Float32Array;
    /**
     * Volumetric section payload for the CAD-style capped section view: the
     * recovered NODAL scalar field over the FULL solution grid (void-adjacent
     * nodes back-filled from valid neighbors so the cap can interpolate right
     * up to the skin), the padded nodal displacement field (3/node, straight
     * from the solve — the cap un-deforms its sample point with it in the
     * exaggerated view), the grid layout, and the interior (solid-cell)
     * min/max with their cell-center locations — the true field extremes,
     * which for a skin+infill part often sit INSIDE (perimeter/infill
     * interface), not on the surface. Kinds as in `result_field`;
     * displacement kinds ("u"|"ux"|"uy"|"uz") return an EMPTY values array
     * (the cap shader derives them from `disp` directly) and NaN range.
     * Returns [values f32 (N|0), disp f32 (3N), meta f64
     * [mx,my,mz, ox,oy,oz, h, min,max, minx,miny,minz, maxx,maxy,maxz]].
     */
    section_volume(kind: string): Array<any>;
    /**
     * Set the active world acceleration (mm/s²) for self-weight + remote masses
     * (DESIGN §16). The worker resolves each load step's active acceleration
     * entities to ONE summed vector and sets it here before solving; `[0,0,0]`
     * clears the inertial load. Invalidates the cached solution/design.
     */
    set_accel(ax: number, ay: number, az: number): void;
    /**
     * Flip the active build-sim result between "bonded" (on bed) and "released"
     * (off bed) WITHOUT re-running the build — both were saved by the last
     * `solve_build_sim`. The chosen field becomes `self.solution`, so the
     * deformed Results view (and `vertex_displacements`) re-renders it.
     * JSON: `{ maxDisplacement }`. Errors if no build has been run.
     */
    set_build_state(state: string): string;
    /**
     * Composite skin on/off (see the `composite_skin` field). The grid
     * itself is unaffected — only results depend on the classification.
     */
    set_composite_skin(on: boolean): void;
    /**
     * Re-extract the EXPORTED geometry from the CONTINUOUS optimized field at a
     * new isosurface density `threshold` (0..1) — the post-run "fine-tune how
     * the part looks" knob. SOLID mode rebuilds the single body (with the
     * connected-keep anchored to the load/support regions); BINARY mode rebuilds
     * the dense modifier region. The budget/density target is NOT touched — this
     * only moves the level the shape is cut at. Affects display + exports; the
     * regions are re-smoothed with `smooth_iters`. No-op for graded infill (its
     * regions are bin sets, not a single isosurface level).
     */
    set_iso_threshold(threshold: number, smooth_iters: number): void;
    /**
     * Toggle the shear term of the layer criterion (display-side derived —
     * affects `sfz`/`sf` fields, the orientation sweep and its preview; the
     * solution stays valid).
     */
    set_layer_shear(on: boolean): void;
    /**
     * e0 in MPa, density in g/cm³, strengths in MPa (in-layer tensile and
     * layer-adhesion / cross-layer). `shear_strength_z_mpa` is the interlayer
     * SHEAR strength; pass undefined/None to derive it as 0.6·strength_z.
     */
    set_material(e0: number, nu: number, density_g_cm3: number, strength_mpa: number, strength_z_mpa: number, shear_strength_z_mpa?: number | null): void;
    /**
     * Material (occupancy-decoupled) stress display on/off (see the
     * `material_stress` field). Pure post-processing: the solution stays valid,
     * fields are recomputed on the next fetch; the safety factor is unaffected.
     */
    set_material_stress(on: boolean): void;
    set_resolution(target_cells: number): void;
    /**
     * Smoothed stress display on/off (see the `smooth_stress` field).
     * Pure post-processing: the solution stays valid, fields are simply
     * recomputed on the next fetch.
     */
    set_smooth_stress(on: boolean): void;
    /**
     * Snap the voxel size to an integer fraction of the wall thickness
     * (h = wall/k) so the printed skin is exactly k cell layers on flat
     * faces. 0 disables. Changing the value invalidates grid and results.
     */
    set_snap_wall(wall_mm: number): void;
    /**
     * Surface recovery on/off (see the `surface_recovery` field). Pure
     * post-processing: the solution stays valid, fields are recomputed on the
     * next fetch. Off reproduces the pre-2026-08 read-back exactly.
     */
    set_surface_recovery(on: boolean): void;
    /**
     * Custom resolution: pin the analysis cell size to exactly `h` mm (still
     * snapped to the wall when snapping is on), bypassing the automatic
     * part-volume sizing. Clamped to a sane range; capped by the cell budget.
     */
    set_voxel_size(h: number): void;
    /**
     * **Settings Optimizer** (DESIGN §20): search uniform print settings —
     * perimeters × infill % — for the LIGHTEST print whose safety factor still
     * clears `sfTarget`.
     *
     * Everything runs on the CURRENT analysis grid (dec. 9): each candidate is
     * re-classified into skin / composite-wall / infill cells there and solved
     * under every included load step, then reduced to the §17 criterion with
     * the §20 BC exclusion applied. Line width, layer height and pattern are
     * held at the user's values — they are printer choices, not strength knobs
     * (dec. 4); the shell count follows the walls
     * (`ceil(perimeters·lineWidth / layerHeight)`).
     *
     * `mode: "search"` (default) walks the dec. 8 bisection + weight pruning
     * (typically 15–30 solves). `mode: "full"` backfills the whole 8 × 13
     * landscape, skipping the `skip` cells a previous call already solved.
     *
     * `progress` receives one JSON push per solved candidate. Returns JSON
     * `{ walls, densities, candidates, winner, feasible, bestSf, prunedWalls,
     * solves, excludedCells, scoredCells, … }`.
     */
    settings_sweep(opts_json: string, progress: Function): string;
    /**
     * Run the static solve. JSON: { iterations, relResidual, maxDisplacement }.
     */
    solve(): string;
    /**
     * FDM build simulation (inherent strain, see `filasim_core::buildsim`): predict
     * warping + bed peel from the current voxelization. Ignores structural BCs —
     * the only "loads" are the per-layer eigenstrain and the build plate. Leaves
     * the chosen state (released = off-bed sprung shape, or bonded) as the live
     * solution, so `vertex_displacements()` maps the warp onto the REAL mesh and
     * the existing deformed view renders it. JSON: max displacements + peel peaks.
     * `on_layer(layersDone, totalLayers, displacements)` is called per activated
     * layer for the live progress bar + warp preview. `displacements` is the
     * accumulating bonded warp mapped onto the mesh, but only on throttled frames
     * (~30 over the build); it is an empty array on the other layers (progress-
     * only). A stopped run (cancel flag) propagates as an error.
     */
    solve_build_sim(opts_json: string, on_layer: Function): string;
    /**
     * Re-solve the CURRENT optimized design under the CURRENT BCs — the per-step
     * pass that fills the Results roster after a multi-load optimization
     * (DESIGN §13). The optimized design's stress eps (density → element
     * stiffness) is BC-independent, so every load step reuses it and only the
     * loads/supports change; steps that share fixtures hit the cached multigrid
     * hierarchy (cheap RHS swap). Requires a prior optimize()/restore — the live
     * solution + eps are left on this step so stash_result snapshots it. JSON
     * matches solve().
     */
    solve_optimized(): string;
    /**
     * Analyze the part AS PRINTED: skin (perimeters × line width) at 100%,
     * interior at a uniform infill ratio through the calibrated pattern law.
     * Same machinery as the optimizer's verification solves — the accuracy
     * is the accuracy of the calibrated E(ρ) curve. Stress/SF fields use
     * the stored eps, so the safety factor of the printed part falls out.
     * JSON: solve() fields + massGrams/massSolidGrams/skinCells/
     * interiorCells/skinLayers for the results dock.
     */
    solve_printed(opts_json: string): string;
    /**
     * Snapshot the CURRENT live solution under `id` so the Results view can
     * recall it instantly later. Re-stashing the same id replaces it.
     */
    stash_result(id: string): void;
    /**
     * Rigid-transform the part in place: p' = R·p + t with `m` =
     * [r00,r01,r02, r10,r11,r12, r20,r21,r22, tx,ty,tz] (row-major R, mm t).
     * Both the working and the original tessellation move, so exports carry
     * the print orientation. Segmentation patches and BC triangle lists are
     * index-based and survive; the grid and every result drop. Z stays the
     * build direction — this is how the user orients the print.
     */
    transform(m: Float64Array): void;
    /**
     * Cumulative orientation transform since import (for project save).
     */
    transform_matrix(): Float64Array;
    triangle_count(): number;
    /**
     * Switch surface patches to the STEP file's exact BREP faces (one patch per
     * CAD face). No-op for STL/3MF models.
     */
    use_cad_faces(): void;
    /**
     * Final binned density per soup vertex (density view).
     */
    vertex_density(): Float32Array;
    /**
     * Displacement vector (mm) per soup vertex: 9 floats per triangle.
     */
    vertex_displacements(): Float32Array;
    /**
     * Deduplicated cell-edge segments of the hull (pairs of xyz f32 points).
     */
    voxel_edges(): Float32Array;
    /**
     * Exposed-face hull of the analysis voxel grid (triangle soup, xyz f32).
     */
    voxel_hull(): Float32Array;
    /**
     * JSON: { nx, ny, nz, h, cells, solid }
     */
    voxel_info(): string;
    /**
     * Voxel mesh for the Mesh view, optionally cut by a plane: cells whose
     * CENTER satisfies n·c + constant < 0 are dropped entirely, exposing the
     * interior cells (voxel-true section — skin thickness inspectable)
     * instead of a planar cut. Returns [positions f32 (9/tri),
     * density f32 (3/tri, the cell's relative material density in [0,1]:
     * skin = 1, interior = its infill ratio — the OPTIMIZED per-cell
     * density when an optimization result exists, else `infill_pct` —
     * composite surface cells blend the two by their wall fraction),
     * edges f32].
     */
    voxel_mesh_cut(cut: boolean, nx: number, ny: number, nz: number, constant: number, wall_mm: number, top_bottom_mm: number, infill_pct: number): Array<any>;
    /**
     * Mesh view of the analysis grid coloured by the last multi-material
     * result: `[hull f32 (9/tri), materialId f32 (3/tri), edges f32]`, cut
     * like `voxel_mesh_cut`. Errors if there is no result yet.
     */
    voxel_mesh_mm(cut: boolean, nx: number, ny: number, nz: number, constant: number): Array<any>;
    /**
     * Result field on the voxel hull: one value per hull vertex (3 per
     * triangle). Default: each triangle carries its OWNING CELL's value —
     * crisp per-cell coloring. With smooth_stress on, every hull vertex IS
     * a grid node, so it carries the recovered nodal value — the hull
     * shades smoothly instead of flat per cell. `solid_body` must match the
     * flag `voxel_results` was fetched with — same mask, so the values line
     * up per triangle AND the nodal recovery ignores the carved (SIMP-floor)
     * cells whose near-void stresses are meaningless. Kinds as in
     * `result_field`.
     */
    voxel_result_field(kind: string, solid_body: boolean): Float32Array;
    /**
     * Voxel-hull result geometry: the analysis mesh with EXACT nodal
     * displacements (hull vertices ARE grid nodes — no surface sampling
     * like the STL view). With `solid_body` on (Part Topo result active)
     * the hull covers only the RETAINED cells, so the validation fields
     * display on the optimized shape instead of the original envelope —
     * silently full when no solid-topo result exists (defensive: the flag
     * follows UI state). Returns [positions f32 (9/tri), displacements
     * f32 (9/tri), edges f32 (6/segment), edge displacements f32].
     */
    voxel_results(solid_body: boolean): Array<any>;
}

/**
 * Read the manifest (project.json) out of a `.filasim` project file.
 */
export function project_manifest(bytes: Uint8Array): string;

/**
 * Extract the embedded original model bytes from a project file.
 */
export function project_model(bytes: Uint8Array): Uint8Array;

/**
 * Install the cooperative cancellation flag: an Int32Array over a
 * SharedArrayBuffer whose element 0 the UI thread sets to nonzero while
 * this worker is blocked inside a solve (a postMessage could never arrive
 * mid-call). The MGCG/SIMP loops poll it and bail out with "cancelled".
 * Must be called on the thread that runs the solves (the worker's message
 * loop) — the checker is thread-local.
 */
export function set_cancel_flag(flag: Int32Array): void;

/**
 * Install the live residual-progress buffer: views over a SharedArrayBuffer
 * the worker writes the MGCG residual trace into while a solve is running, so
 * the UI thread can poll it and redraw the convergence plot live (a
 * postMessage can't arrive while the worker is blocked inside the solve).
 * `count[0]` holds the number of valid residuals; `data[0..count]` are the
 * relative residuals (element 0 = initial). Same thread-local rule as
 * `set_cancel_flag` — call it on the worker's solve thread. Hosts without a
 * SharedArrayBuffer simply never install it; the core's `publish` is then a
 * no-op.
 */
export function set_progress_buffer(count: Int32Array, data: Float32Array): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_model_free: (a: number, b: number) => void;
    readonly bench_solve: (a: number, b: number, c: number, d: number) => number;
    readonly bench_solve_shell: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly bench_voxelize: (a: number) => number;
    readonly model_activate_result: (a: number, b: number, c: number) => [number, number, number, number];
    readonly model_add_bearing: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly model_add_cylindrical: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly model_add_displacement: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly model_add_elastic: (a: number, b: number, c: number, d: number) => void;
    readonly model_add_fixed: (a: number, b: number, c: number) => void;
    readonly model_add_force: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly model_add_frictionless: (a: number, b: number, c: number) => void;
    readonly model_add_load_case: (a: number, b: number) => void;
    readonly model_add_mass: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly model_add_moment: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly model_add_pressure: (a: number, b: number, c: number, d: number) => void;
    readonly model_bbox: (a: number) => [number, number];
    readonly model_body_count: (a: number) => number;
    readonly model_check: (a: number) => [number, number, number, number];
    readonly model_clear_bcs: (a: number) => void;
    readonly model_clear_load_cases: (a: number) => void;
    readonly model_clear_results: (a: number) => void;
    readonly model_criterion_sf: (a: number, b: number, c: number) => [number, number, number, number];
    readonly model_density_isosurface: (a: number, b: number) => [number, number, number];
    readonly model_export_3mf: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly model_export_color_3mf: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number, number];
    readonly model_export_positioned_3mf: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number, number];
    readonly model_export_project: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly model_export_solid_stl: (a: number) => [number, number, number, number];
    readonly model_export_stls: (a: number) => [number, number, number, number];
    readonly model_field_uncertainty: (a: number, b: number, c: number) => [number, number, number, number];
    readonly model_fit_cylinder: (a: number, b: number, c: number) => [number, number];
    readonly model_from_mesh: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number];
    readonly model_has_cad_faces: (a: number) => number;
    readonly model_inherent_strain_voxels: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly model_layer_sf_field: (a: number, b: number, c: number, d: number, e: any) => [number, number, number, number];
    readonly model_layer_sf_voxel_field: (a: number, b: number, c: number, d: number, e: any) => [number, number, number, number];
    readonly model_mesh_object_count: (a: number) => number;
    readonly model_mm_region_count: (a: number) => number;
    readonly model_mm_region_indices: (a: number, b: number) => [number, number];
    readonly model_mm_region_material: (a: number, b: number) => number;
    readonly model_mm_region_positions: (a: number, b: number) => [number, number];
    readonly model_mm_run: (a: number, b: number, c: number, d: any) => [number, number, number, number];
    readonly model_modal_analysis: (a: number, b: number, c: number, d: any) => [number, number, number, number];
    readonly model_new: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly model_optimize: (a: number, b: number, c: number, d: any) => [number, number, number, number];
    readonly model_orientation_sweep_begin: (a: number, b: any, c: number) => [number, number, number, number];
    readonly model_orientation_sweep_end: (a: number) => void;
    readonly model_orientation_sweep_rows: (a: number, b: number, c: number) => [number, number, number];
    readonly model_original_positions: (a: number) => [number, number];
    readonly model_patch_count: (a: number) => number;
    readonly model_patch_ids: (a: number) => [number, number];
    readonly model_peel_field: (a: number, b: number, c: number) => [number, number, number, number];
    readonly model_peel_map: (a: number, b: number, c: number) => [number, number, number];
    readonly model_positions: (a: number) => [number, number];
    readonly model_reaction_forces: (a: number) => [number, number, number, number];
    readonly model_refinement_parents: (a: number) => [number, number];
    readonly model_region_count: (a: number) => number;
    readonly model_region_density: (a: number, b: number) => number;
    readonly model_region_indices: (a: number, b: number) => [number, number];
    readonly model_region_positions: (a: number, b: number) => [number, number];
    readonly model_resegment: (a: number, b: number) => void;
    readonly model_resmooth_regions: (a: number, b: number) => [number, number];
    readonly model_restore_optimization: (a: number, b: number, c: number) => [number, number];
    readonly model_restore_project: (a: number, b: number, c: number) => [number, number, number, number];
    readonly model_restore_result: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly model_result_field: (a: number, b: number, c: number) => [number, number, number, number];
    readonly model_section_volume: (a: number, b: number, c: number) => [number, number, number];
    readonly model_set_accel: (a: number, b: number, c: number, d: number) => void;
    readonly model_set_build_state: (a: number, b: number, c: number) => [number, number, number, number];
    readonly model_set_composite_skin: (a: number, b: number) => void;
    readonly model_set_iso_threshold: (a: number, b: number, c: number) => [number, number];
    readonly model_set_layer_shear: (a: number, b: number) => void;
    readonly model_set_material: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly model_set_material_stress: (a: number, b: number) => void;
    readonly model_set_resolution: (a: number, b: number) => void;
    readonly model_set_smooth_stress: (a: number, b: number) => void;
    readonly model_set_snap_wall: (a: number, b: number) => void;
    readonly model_set_surface_recovery: (a: number, b: number) => void;
    readonly model_set_voxel_size: (a: number, b: number) => void;
    readonly model_settings_sweep: (a: number, b: number, c: number, d: any) => [number, number, number, number];
    readonly model_solve: (a: number) => [number, number, number, number];
    readonly model_solve_build_sim: (a: number, b: number, c: number, d: any) => [number, number, number, number];
    readonly model_solve_optimized: (a: number) => [number, number, number, number];
    readonly model_solve_printed: (a: number, b: number, c: number) => [number, number, number, number];
    readonly model_stash_result: (a: number, b: number, c: number) => [number, number];
    readonly model_transform: (a: number, b: number, c: number) => [number, number];
    readonly model_transform_matrix: (a: number) => [number, number];
    readonly model_triangle_count: (a: number) => number;
    readonly model_use_cad_faces: (a: number) => void;
    readonly model_vertex_density: (a: number) => [number, number, number, number];
    readonly model_vertex_displacements: (a: number) => [number, number, number, number];
    readonly model_voxel_edges: (a: number) => [number, number, number, number];
    readonly model_voxel_hull: (a: number) => [number, number, number, number];
    readonly model_voxel_info: (a: number) => [number, number, number, number];
    readonly model_voxel_mesh_cut: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number];
    readonly model_voxel_mesh_mm: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly model_voxel_result_field: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly model_voxel_results: (a: number, b: number) => [number, number, number];
    readonly project_manifest: (a: number, b: number) => [number, number, number, number];
    readonly project_model: (a: number, b: number) => [number, number, number, number];
    readonly set_cancel_flag: (a: any) => void;
    readonly set_progress_buffer: (a: any, b: any) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
