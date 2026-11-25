/* @ts-self-types="./filasim_wasm.d.ts" */

export class Model {
    static __wrap(ptr) {
        const obj = Object.create(Model.prototype);
        obj.__wbg_ptr = ptr;
        ModelFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ModelFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_model_free(ptr, 0);
    }
    /**
     * Make a previously stashed result the live solution (for displacement +
     * stress/strain queries) and return its per-soup-vertex displacements so
     * the viewport can re-deform without a second round-trip.
     * @param {string} id
     * @returns {Float32Array}
     */
    activate_result(id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.model_activate_result(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * Bearing load (N): radial force on a cylindrical bore, cosine-distributed
     * over the loaded half (Ansys-style). Axial component is rejected.
     * @param {Uint32Array} tris
     * @param {number} fx
     * @param {number} fy
     * @param {number} fz
     */
    add_bearing(tris, fx, fy, fz) {
        const ptr0 = passArray32ToWasm0(tris, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.model_add_bearing(this.__wbg_ptr, ptr0, len0, fx, fy, fz);
    }
    /**
     * Cylindrical support: lock any subset of the LOCAL cylinder directions of
     * a cylindrical selection — radial / tangential / axial (Ansys-style). The
     * selection is fitted to a cylinder; each locked direction gets stiff
     * penalty springs per node. Radial+axial with tangential free = a journal
     * bearing (the part can still turn about the axis).
     * @param {Uint32Array} tris
     * @param {boolean} radial
     * @param {boolean} tangential
     * @param {boolean} axial
     */
    add_cylindrical(tris, radial, tangential, axial) {
        const ptr0 = passArray32ToWasm0(tris, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.model_add_cylindrical(this.__wbg_ptr, ptr0, len0, radial, tangential, axial);
    }
    /**
     * Displacement support: prescribe the selected global axes (x/y/z) to a
     * value in mm (0 = pin to zero), leaving the unselected ones free.
     * @param {Uint32Array} tris
     * @param {boolean} fx
     * @param {boolean} fy
     * @param {boolean} fz
     * @param {number} vx
     * @param {number} vy
     * @param {number} vz
     */
    add_displacement(tris, fx, fy, fz, vx, vy, vz) {
        const ptr0 = passArray32ToWasm0(tris, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.model_add_displacement(this.__wbg_ptr, ptr0, len0, fx, fy, fz, vx, vy, vz);
    }
    /**
     * Elastic ("soft") support: Winkler foundation, bedding modulus k in
     * N/mm³ (surface pressure per unit displacement, σ = k·u).
     * @param {Uint32Array} tris
     * @param {number} k
     */
    add_elastic(tris, k) {
        const ptr0 = passArray32ToWasm0(tris, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.model_add_elastic(this.__wbg_ptr, ptr0, len0, k);
    }
    /**
     * @param {Uint32Array} tris
     */
    add_fixed(tris) {
        const ptr0 = passArray32ToWasm0(tris, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.model_add_fixed(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {Uint32Array} tris
     * @param {number} fx
     * @param {number} fy
     * @param {number} fz
     */
    add_force(tris, fx, fy, fz) {
        const ptr0 = passArray32ToWasm0(tris, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.model_add_force(this.__wbg_ptr, ptr0, len0, fx, fy, fz);
    }
    /**
     * @param {Uint32Array} tris
     */
    add_frictionless(tris) {
        const ptr0 = passArray32ToWasm0(tris, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.model_add_frictionless(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Snapshot the CURRENT `bcs` (+ the active acceleration `set_bcs` resolved
     * for this step) as a weighted load case for the multi-load optimizer. Call
     * after `set_bcs`/`add_*` have populated this step's BCs. The accel snapshot
     * lets the optimizer recompute each case's design-dependent self-weight
     * (DESIGN §16 dec. 4).
     * @param {number} weight
     */
    add_load_case(weight) {
        wasm.model_add_load_case(this.__wbg_ptr, weight);
    }
    /**
     * Remote point mass (DESIGN §16): a component of `mass` TONNE with its CG at
     * world `(px,py,pz)` mm, bolted to the selected patch. `rigid` picks the
     * mount: DEFORMABLE (false) loads the patch with F = m·a + the transported
     * couple (p − c) × F, adding no stiffness; RIGID (true, milestone 4) also
     * stiffens the patch by tying it to a 6-DOF master at the CG (the load then
     * distributes by the rigidity kinematics). Inert (load-wise) with no accel;
     * the rigid stiffness is present regardless.
     * @param {Uint32Array} tris
     * @param {number} px
     * @param {number} py
     * @param {number} pz
     * @param {number} mass
     * @param {boolean} rigid
     */
    add_mass(tris, px, py, pz, mass, rigid) {
        const ptr0 = passArray32ToWasm0(tris, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.model_add_mass(this.__wbg_ptr, ptr0, len0, px, py, pz, mass, rigid);
    }
    /**
     * Moment (N·mm): deformable distributed couple over the selection.
     * @param {Uint32Array} tris
     * @param {number} mx
     * @param {number} my
     * @param {number} mz
     */
    add_moment(tris, mx, my, mz) {
        const ptr0 = passArray32ToWasm0(tris, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.model_add_moment(this.__wbg_ptr, ptr0, len0, mx, my, mz);
    }
    /**
     * @param {Uint32Array} tris
     * @param {number} mpa
     */
    add_pressure(tris, mpa) {
        const ptr0 = passArray32ToWasm0(tris, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.model_add_pressure(this.__wbg_ptr, ptr0, len0, mpa);
    }
    /**
     * [lox, loy, loz, hix, hiy, hiz] in mm.
     * @returns {Float64Array}
     */
    bbox() {
        const ret = wasm.model_bbox(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * Disconnected solid bodies in the working mesh (cavity shells and debris
     * don't count). UI warns when > 1 — the solver can't join separate bodies.
     * @returns {number}
     */
    body_count() {
        const ret = wasm.model_body_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Island + rigid-body-mode check. JSON CheckReport.
     * @returns {string}
     */
    check() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.model_check(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    clear_bcs() {
        wasm.model_clear_bcs(this.__wbg_ptr);
    }
    /**
     * Drop all registered multi-load optimization cases (DESIGN §13). The front
     * end calls this before EACH optimize, then `add_load_case` per included
     * step (none ⇒ single-load).
     */
    clear_load_cases() {
        wasm.model_clear_load_cases(this.__wbg_ptr);
    }
    /**
     * Drop every stashed result (geometry/grid change — all are stale and the
     * node grid they sample no longer matches the part).
     */
    clear_results() {
        wasm.model_clear_results(this.__wbg_ptr);
    }
    /**
     * **Criterion of the LIVE solution** (DESIGN §17 dec. 4 + §20 dec. 5):
     * SF_crit and where it binds, computed from whatever result is currently
     * active — no solve, no re-assembly, nothing invalidated. This is how the
     * Settings Optimizer verifies its delivery after the standard As-Printed
     * run: the number comes from the SAME field the user is looking at.
     * JSON `{ sf, excludedCells, scoredCells, worst: {x, y, z, sf} | null }`.
     * @param {string} measure
     * @returns {string}
     */
    criterion_sf(measure) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(measure, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.model_criterion_sf(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Isosurface of the final continuous density field at `threshold`
     * (0..1): everything denser than the threshold. Returns
     * [positions f32, indices u32, per-vertex density f32] for the
     * cutaway view (colored with the density legend ramp).
     * @param {number} threshold
     * @returns {Array<any>}
     */
    density_isosurface(threshold) {
        const ret = wasm.model_density_isosurface(this.__wbg_ptr, threshold);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
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
     * @param {string} slicer
     * @param {Uint8Array} thumbnail
     * @returns {Uint8Array}
     */
    export_3mf(slicer, thumbnail) {
        const ptr0 = passStringToWasm0(slicer, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(thumbnail, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.model_export_3mf(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v3;
    }
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
     * @param {string} kind
     * @param {number} lo
     * @param {number} hi
     * @param {number} steps
     * @param {string} colors_json
     * @param {Uint8Array} thumbnail
     * @returns {Uint8Array}
     */
    export_color_3mf(kind, lo, hi, steps, colors_json, thumbnail) {
        const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(colors_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(thumbnail, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.model_export_color_3mf(this.__wbg_ptr, ptr0, len0, lo, hi, steps, ptr1, len1, ptr2, len2);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v4;
    }
    /**
     * Slicer project 3MF with NO modifier volumes — just the part, placed on
     * the plate in the orientation the analysis ran in and carrying the walls,
     * shells and infill the analysis assumed. This is the hand-off for the runs
     * that have no modifier geometry to ship: a plain as-printed analysis, and
     * Part Topo (`optimized` swaps the imported part for the kept-material
     * body). Same flavors as `export_3mf`; `base_density` is a fraction.
     * @param {string} slicer
     * @param {Uint8Array} thumbnail
     * @param {number} base_density
     * @param {number} wall_loops
     * @param {number} top_bottom_layers
     * @param {boolean} optimized
     * @returns {Uint8Array}
     */
    export_positioned_3mf(slicer, thumbnail, base_density, wall_loops, top_bottom_layers, optimized) {
        const ptr0 = passStringToWasm0(slicer, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(thumbnail, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.model_export_positioned_3mf(this.__wbg_ptr, ptr0, len0, ptr1, len1, base_density, wall_loops, top_bottom_layers, optimized);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v3;
    }
    /**
     * Assemble a `.filasim` project zip: the original model bytes, the JS-built
     * manifest (settings + BCs + result roster), the compact optimized design,
     * and — when `include_results` — every stashed result's displacement + eps.
     * @param {Uint8Array} model_bytes
     * @param {string} model_entry
     * @param {string} manifest
     * @param {boolean} include_results
     * @returns {Uint8Array}
     */
    export_project(model_bytes, model_entry, manifest, include_results) {
        const ptr0 = passArray8ToWasm0(model_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(model_entry, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(manifest, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.model_export_project(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, include_results);
        var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v4;
    }
    /**
     * SOLID topology mode: the single optimized body as one binary STL (the
     * regions hold exactly one kept-material mesh). Re-sliceable / re-CAD-able.
     * @returns {Uint8Array}
     */
    export_solid_stl() {
        const ret = wasm.model_export_solid_stl(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Zip of one binary STL per modifier region.
     * @returns {Uint8Array}
     */
    export_stls() {
        const ret = wasm.model_export_stls(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
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
     * @param {string} kind
     * @returns {string}
     */
    field_uncertainty(kind) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.model_field_uncertainty(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Fit a triangle selection to a cylinder and return the result as JSON:
     * `{ok, axis:[3], point:[3], radius, residual}`. `ok` is true only when the
     * cylindricity residual is within tolerance — the front end uses it to
     * accept/reject a bearing-load selection and to draw the axis glyph.
     * @param {Uint32Array} tris
     * @returns {string}
     */
    fit_cylinder(tris) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ptr0 = passArray32ToWasm0(tris, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.model_fit_cylinder(this.__wbg_ptr, ptr0, len0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Pre-tessellated import (DESIGN §18): meshStep runs in a JS import
     * worker and hands over an indexed mesh (mm, welded) with per-triangle
     * CAD-face and solid ids. Both id arrays must be DENSE indices — the JS
     * side densifies the STEP entity record numbers and keeps the dense→
     * entity-id tables for persistence, so `cad_segmentation`'s max+1 patch
     * sizing stays bounded by the real face count. Refinement + segmentation
     * are identical to the bytes path with CAD faces present.
     * @param {Float32Array} positions
     * @param {Uint32Array} indices
     * @param {Uint32Array} face_of_tri
     * @param {Uint32Array} solid_of_tri
     * @param {string} name
     * @returns {Model}
     */
    static from_mesh(positions, indices, face_of_tri, solid_of_tri, name) {
        const ptr0 = passArrayF32ToWasm0(positions, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray32ToWasm0(indices, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray32ToWasm0(face_of_tri, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray32ToWasm0(solid_of_tri, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ret = wasm.model_from_mesh(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Model.__wrap(ret[0]);
    }
    /**
     * True when this model was imported from STEP and exact BREP faces are
     * available as a surface-patch source.
     * @returns {boolean}
     */
    has_cad_faces() {
        const ret = wasm.model_has_cad_faces(this.__wbg_ptr);
        return ret !== 0;
    }
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
     * @param {number} layer_max
     * @param {number} shrink_xy
     * @param {number} shrink_z
     * @returns {Array<any>}
     */
    inherent_strain_voxels(layer_max, shrink_xy, shrink_z) {
        const ret = wasm.model_inherent_strain_voxels(this.__wbg_ptr, layer_max, shrink_xy, shrink_z);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Per-vertex layer-adhesion SF for ONE build direction `n = (a, b, c)` —
     * the preview recolor when a heatmap pixel is clicked. Folds the same
     * result set as `orientation_sweep_begin` (elementwise min across load
     * steps), sampled to the display surface exactly like `result_field`
     * (smooth or per-cell). NOT ring-masked — the smoothed STL surface
     * hides nothing (greying happens on the per-cell voxel hull, below).
     * @param {number} a
     * @param {number} b
     * @param {number} c
     * @param {Array<any>} ids
     * @returns {Float32Array}
     */
    layer_sf_field(a, b, c, ids) {
        const ret = wasm.model_layer_sf_field(this.__wbg_ptr, a, b, c, ids);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Voxel-hull variant of `layer_sf_field`: one value per hull vertex
     * (the owning cell's — crisp per-cell, like `voxel_result_field`).
     * Constraint-ring cells (excluded from the sweep SCORE, §15 dec. 3)
     * return NaN — the viewer paints them flat GREY, so the voxel view
     * shows exactly which cells the score ignores.
     * @param {number} a
     * @param {number} b
     * @param {number} c
     * @param {Array<any>} ids
     * @returns {Float32Array}
     */
    layer_sf_voxel_field(a, b, c, ids) {
        const ret = wasm.model_layer_sf_voxel_field(this.__wbg_ptr, a, b, c, ids);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Number of mesh objects found in the imported file (UI warns when >1).
     * @returns {number}
     */
    mesh_object_count() {
        const ret = wasm.model_mesh_object_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    mm_region_count() {
        const ret = wasm.model_mm_region_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} i
     * @returns {Uint32Array}
     */
    mm_region_indices(i) {
        const ret = wasm.model_mm_region_indices(this.__wbg_ptr, i);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {number} i
     * @returns {number}
     */
    mm_region_material(i) {
        const ret = wasm.model_mm_region_material(this.__wbg_ptr, i);
        return ret >>> 0;
    }
    /**
     * @param {number} i
     * @returns {Float32Array}
     */
    mm_region_positions(i) {
        const ret = wasm.model_mm_region_positions(this.__wbg_ptr, i);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Run the general multi-material optimizer on the current setup
     * (supports + loads from the normal boundary conditions). Returns JSON
     * with the metrics of the optimized design and of every single-material
     * baseline; region meshes are fetched with `mm_region_*`.
     * `progress` is called as `progress(jsonString)` once per iteration.
     * @param {string} opts_json
     * @param {Function} progress
     * @returns {string}
     */
    mm_run(opts_json, progress) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(opts_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.model_mm_run(this.__wbg_ptr, ptr0, len0, progress);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
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
     * @param {string} opts_json
     * @param {Function} on_progress
     * @returns {string}
     */
    modal_analysis(opts_json, on_progress) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(opts_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.model_modal_analysis(this.__wbg_ptr, ptr0, len0, on_progress);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Parse STL (binary/ASCII) or 3MF (zip magic); segment at 10° (fine
     * patches pick better; the slider re-segments live). STEP loads through
     * `from_mesh` — tessellated JS-side by meshStep (DESIGN §18).
     * @param {Uint8Array} bytes
     * @param {string} name
     */
    constructor(bytes, name) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.model_new(ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        ModelFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
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
     * @param {string} opts_json
     * @param {Function} progress
     * @returns {string}
     */
    optimize(opts_json, progress) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(opts_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.model_optimize(this.__wbg_ptr, ptr0, len0, progress);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * @param {Array<any>} ids
     * @param {number} step_deg
     * @returns {string}
     */
    orientation_sweep_begin(ids, step_deg) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.model_orientation_sweep_begin(this.__wbg_ptr, ids, step_deg);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Drop the sweep context built by `orientation_sweep_begin`.
     */
    orientation_sweep_end() {
        wasm.model_orientation_sweep_end(this.__wbg_ptr);
    }
    /**
     * Sweep pixels `[start, start+count)` of the flattened grid started by
     * `orientation_sweep_begin`. Returns `[scored, all]` — two Float32Arrays
     * of min layer-adhesion SF per pixel: `scored` excludes the constraint
     * ring, `all` hides nothing; both capped at SF_CAP. Chunk the calls so
     * the worker can post progress between them.
     * @param {number} start
     * @param {number} count
     * @returns {Array<any>}
     */
    orientation_sweep_rows(start, count) {
        const ret = wasm.model_orientation_sweep_rows(this.__wbg_ptr, start, count);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * ORIGINAL (as-imported) tessellation as a triangle soup, 9 floats per
     * triangle. It follows every `transform` like the working mesh, but is
     * NOT display-refined — the refinement is non-conforming (T-junctions),
     * so viewport edge detection must run on THIS mesh (a T-junction edge
     * has no exact partner and either paints noise or hides real creases).
     * @returns {Float32Array}
     */
    original_positions() {
        const ret = wasm.model_original_positions(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {number}
     */
    patch_count() {
        const ret = wasm.model_patch_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Patch id per triangle.
     * @returns {Uint32Array}
     */
    patch_ids() {
        const ret = wasm.model_patch_ids(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Bed-peel risk as a per-mesh-vertex scalar (3 per display triangle, same
     * layout as `result_field`), sampled from the last build sim's bed
     * reactions. `kind`: "peel" = upward lift (+Z, the peel driver), "peelshear"
     * = in-plane bed shear magnitude. Each vertex takes the reaction at its
     * nearest footprint node, ramped to zero over the first layers so the risk
     * reads at the base. Traction in MPa, uncalibrated (a RELATIVE indicator).
     * Errors if no build sim has been run.
     * @param {string} kind
     * @returns {Float32Array}
     */
    peel_field(kind) {
        const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.model_peel_field(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * Bed-peel as a flat heatmap sitting ON the build plate: a triangle soup
     * covering the part's FOOTPRINT (bottom-layer solid cells of the coarse
     * build grid) at z = bed, plus a per-vertex value (lift or shear). Lets the
     * risk be read from a normal top/iso view instead of from under the part.
     * Returns `[positions Float32Array (9/tri), values Float32Array (3/tri)]`.
     * @param {string} kind
     * @returns {Array<any>}
     */
    peel_map(kind) {
        const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.model_peel_map(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Triangle soup positions, 9 floats per triangle (three.js non-indexed).
     * @returns {Float32Array}
     */
    positions() {
        const ret = wasm.model_positions(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
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
     * @returns {string}
     */
    reaction_forces() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.model_reaction_forces(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * ORIGINAL (as-imported) triangle index per working-mesh triangle — the
     * display-refinement parent map (identity when no refinement ran). The
     * exact display→source identity assembly bookkeeping needs; JS must not
     * reconstruct it geometrically (the refinement's triangle order is an
     * implementation detail no walk should depend on).
     * @returns {Uint32Array}
     */
    refinement_parents() {
        const ret = wasm.model_refinement_parents(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {number}
     */
    region_count() {
        const ret = wasm.model_region_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} i
     * @returns {number}
     */
    region_density(i) {
        const ret = wasm.model_region_density(this.__wbg_ptr, i);
        return ret;
    }
    /**
     * @param {number} i
     * @returns {Uint32Array}
     */
    region_indices(i) {
        const ret = wasm.model_region_indices(this.__wbg_ptr, i);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {number} i
     * @returns {Float32Array}
     */
    region_positions(i) {
        const ret = wasm.model_region_positions(this.__wbg_ptr, i);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Re-run segmentation with a different crease angle (degrees). Switches the
     * surface patches back to dihedral region-growing (away from CAD faces).
     * @param {number} angle_deg
     */
    resegment(angle_deg) {
        wasm.model_resegment(this.__wbg_ptr, angle_deg);
    }
    /**
     * Re-apply constrained smoothing to the extracted regions (live preview
     * of the smoothing slider). Affects display AND subsequent exports.
     * @param {number} iters
     */
    resmooth_regions(iters) {
        const ret = wasm.model_resmooth_regions(this.__wbg_ptr, iters);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Rebuild `self.opt` (+ the optimized stress eps) from a saved design blob.
     * Settings (material/resolution/snap/composite) and the orientation must be
     * applied first so the grid + cell classification match the saved run.
     * @param {Uint8Array} blob
     */
    restore_optimization(blob) {
        const ptr0 = passArray8ToWasm0(blob, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.model_restore_optimization(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Read design.bin + results/*.f32 out of a project zip and restore them.
     * The model + its settings/orientation must already be set up. Returns JSON
     * { restoredResults: [...ids], hasDesign }.
     * @param {Uint8Array} project_bytes
     * @returns {string}
     */
    restore_project(project_bytes) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passArray8ToWasm0(project_bytes, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.model_restore_project(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Inject a saved result's displacement (+eps) into the stash so the Results
     * view can show/switch to it without re-solving. The grid must already be
     * built (restore the design, or ensure the grid, first).
     * @param {string} id
     * @param {Uint8Array} blob
     */
    restore_result(id, blob) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(blob, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.model_restore_result(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
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
     * @param {string} kind
     * @returns {Float32Array}
     */
    result_field(kind) {
        const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.model_result_field(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
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
     * @param {string} kind
     * @returns {Array<any>}
     */
    section_volume(kind) {
        const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.model_section_volume(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Set the active world acceleration (mm/s²) for self-weight + remote masses
     * (DESIGN §16). The worker resolves each load step's active acceleration
     * entities to ONE summed vector and sets it here before solving; `[0,0,0]`
     * clears the inertial load. Invalidates the cached solution/design.
     * @param {number} ax
     * @param {number} ay
     * @param {number} az
     */
    set_accel(ax, ay, az) {
        wasm.model_set_accel(this.__wbg_ptr, ax, ay, az);
    }
    /**
     * Flip the active build-sim result between "bonded" (on bed) and "released"
     * (off bed) WITHOUT re-running the build — both were saved by the last
     * `solve_build_sim`. The chosen field becomes `self.solution`, so the
     * deformed Results view (and `vertex_displacements`) re-renders it.
     * JSON: `{ maxDisplacement }`. Errors if no build has been run.
     * @param {string} state
     * @returns {string}
     */
    set_build_state(state) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(state, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.model_set_build_state(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Composite skin on/off (see the `composite_skin` field). The grid
     * itself is unaffected — only results depend on the classification.
     * @param {boolean} on
     */
    set_composite_skin(on) {
        wasm.model_set_composite_skin(this.__wbg_ptr, on);
    }
    /**
     * Re-extract the EXPORTED geometry from the CONTINUOUS optimized field at a
     * new isosurface density `threshold` (0..1) — the post-run "fine-tune how
     * the part looks" knob. SOLID mode rebuilds the single body (with the
     * connected-keep anchored to the load/support regions); BINARY mode rebuilds
     * the dense modifier region. The budget/density target is NOT touched — this
     * only moves the level the shape is cut at. Affects display + exports; the
     * regions are re-smoothed with `smooth_iters`. No-op for graded infill (its
     * regions are bin sets, not a single isosurface level).
     * @param {number} threshold
     * @param {number} smooth_iters
     */
    set_iso_threshold(threshold, smooth_iters) {
        const ret = wasm.model_set_iso_threshold(this.__wbg_ptr, threshold, smooth_iters);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Toggle the shear term of the layer criterion (display-side derived —
     * affects `sfz`/`sf` fields, the orientation sweep and its preview; the
     * solution stays valid).
     * @param {boolean} on
     */
    set_layer_shear(on) {
        wasm.model_set_layer_shear(this.__wbg_ptr, on);
    }
    /**
     * e0 in MPa, density in g/cm³, strengths in MPa (in-layer tensile and
     * layer-adhesion / cross-layer). `shear_strength_z_mpa` is the interlayer
     * SHEAR strength; pass undefined/None to derive it as 0.6·strength_z.
     * @param {number} e0
     * @param {number} nu
     * @param {number} density_g_cm3
     * @param {number} strength_mpa
     * @param {number} strength_z_mpa
     * @param {number | null} [shear_strength_z_mpa]
     */
    set_material(e0, nu, density_g_cm3, strength_mpa, strength_z_mpa, shear_strength_z_mpa) {
        wasm.model_set_material(this.__wbg_ptr, e0, nu, density_g_cm3, strength_mpa, strength_z_mpa, !isLikeNone(shear_strength_z_mpa), isLikeNone(shear_strength_z_mpa) ? 0 : shear_strength_z_mpa);
    }
    /**
     * Material (occupancy-decoupled) stress display on/off (see the
     * `material_stress` field). Pure post-processing: the solution stays valid,
     * fields are recomputed on the next fetch; the safety factor is unaffected.
     * @param {boolean} on
     */
    set_material_stress(on) {
        wasm.model_set_material_stress(this.__wbg_ptr, on);
    }
    /**
     * @param {number} target_cells
     */
    set_resolution(target_cells) {
        wasm.model_set_resolution(this.__wbg_ptr, target_cells);
    }
    /**
     * Smoothed stress display on/off (see the `smooth_stress` field).
     * Pure post-processing: the solution stays valid, fields are simply
     * recomputed on the next fetch.
     * @param {boolean} on
     */
    set_smooth_stress(on) {
        wasm.model_set_smooth_stress(this.__wbg_ptr, on);
    }
    /**
     * Snap the voxel size to an integer fraction of the wall thickness
     * (h = wall/k) so the printed skin is exactly k cell layers on flat
     * faces. 0 disables. Changing the value invalidates grid and results.
     * @param {number} wall_mm
     */
    set_snap_wall(wall_mm) {
        wasm.model_set_snap_wall(this.__wbg_ptr, wall_mm);
    }
    /**
     * Surface recovery on/off (see the `surface_recovery` field). Pure
     * post-processing: the solution stays valid, fields are recomputed on the
     * next fetch. Off reproduces the pre-2026-08 read-back exactly.
     * @param {boolean} on
     */
    set_surface_recovery(on) {
        wasm.model_set_surface_recovery(this.__wbg_ptr, on);
    }
    /**
     * Custom resolution: pin the analysis cell size to exactly `h` mm (still
     * snapped to the wall when snapping is on), bypassing the automatic
     * part-volume sizing. Clamped to a sane range; capped by the cell budget.
     * @param {number} h
     */
    set_voxel_size(h) {
        wasm.model_set_voxel_size(this.__wbg_ptr, h);
    }
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
     * @param {string} opts_json
     * @param {Function} progress
     * @returns {string}
     */
    settings_sweep(opts_json, progress) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(opts_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.model_settings_sweep(this.__wbg_ptr, ptr0, len0, progress);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Run the static solve. JSON: { iterations, relResidual, maxDisplacement }.
     * @returns {string}
     */
    solve() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.model_solve(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
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
     * @param {string} opts_json
     * @param {Function} on_layer
     * @returns {string}
     */
    solve_build_sim(opts_json, on_layer) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(opts_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.model_solve_build_sim(this.__wbg_ptr, ptr0, len0, on_layer);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Re-solve the CURRENT optimized design under the CURRENT BCs — the per-step
     * pass that fills the Results roster after a multi-load optimization
     * (DESIGN §13). The optimized design's stress eps (density → element
     * stiffness) is BC-independent, so every load step reuses it and only the
     * loads/supports change; steps that share fixtures hit the cached multigrid
     * hierarchy (cheap RHS swap). Requires a prior optimize()/restore — the live
     * solution + eps are left on this step so stash_result snapshots it. JSON
     * matches solve().
     * @returns {string}
     */
    solve_optimized() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.model_solve_optimized(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Analyze the part AS PRINTED: skin (perimeters × line width) at 100%,
     * interior at a uniform infill ratio through the calibrated pattern law.
     * Same machinery as the optimizer's verification solves — the accuracy
     * is the accuracy of the calibrated E(ρ) curve. Stress/SF fields use
     * the stored eps, so the safety factor of the printed part falls out.
     * JSON: solve() fields + massGrams/massSolidGrams/skinCells/
     * interiorCells/skinLayers for the results dock.
     * @param {string} opts_json
     * @returns {string}
     */
    solve_printed(opts_json) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(opts_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.model_solve_printed(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Snapshot the CURRENT live solution under `id` so the Results view can
     * recall it instantly later. Re-stashing the same id replaces it.
     * @param {string} id
     */
    stash_result(id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.model_stash_result(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Rigid-transform the part in place: p' = R·p + t with `m` =
     * [r00,r01,r02, r10,r11,r12, r20,r21,r22, tx,ty,tz] (row-major R, mm t).
     * Both the working and the original tessellation move, so exports carry
     * the print orientation. Segmentation patches and BC triangle lists are
     * index-based and survive; the grid and every result drop. Z stays the
     * build direction — this is how the user orients the print.
     * @param {Float64Array} m
     */
    transform(m) {
        const ptr0 = passArrayF64ToWasm0(m, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.model_transform(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Cumulative orientation transform since import (for project save).
     * @returns {Float64Array}
     */
    transform_matrix() {
        const ret = wasm.model_transform_matrix(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {number}
     */
    triangle_count() {
        const ret = wasm.model_triangle_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Switch surface patches to the STEP file's exact BREP faces (one patch per
     * CAD face). No-op for STL/3MF models.
     */
    use_cad_faces() {
        wasm.model_use_cad_faces(this.__wbg_ptr);
    }
    /**
     * Final binned density per soup vertex (density view).
     * @returns {Float32Array}
     */
    vertex_density() {
        const ret = wasm.model_vertex_density(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Displacement vector (mm) per soup vertex: 9 floats per triangle.
     * @returns {Float32Array}
     */
    vertex_displacements() {
        const ret = wasm.model_vertex_displacements(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Deduplicated cell-edge segments of the hull (pairs of xyz f32 points).
     * @returns {Float32Array}
     */
    voxel_edges() {
        const ret = wasm.model_voxel_edges(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Exposed-face hull of the analysis voxel grid (triangle soup, xyz f32).
     * @returns {Float32Array}
     */
    voxel_hull() {
        const ret = wasm.model_voxel_hull(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * JSON: { nx, ny, nz, h, cells, solid }
     * @returns {string}
     */
    voxel_info() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.model_voxel_info(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
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
     * @param {boolean} cut
     * @param {number} nx
     * @param {number} ny
     * @param {number} nz
     * @param {number} constant
     * @param {number} wall_mm
     * @param {number} top_bottom_mm
     * @param {number} infill_pct
     * @returns {Array<any>}
     */
    voxel_mesh_cut(cut, nx, ny, nz, constant, wall_mm, top_bottom_mm, infill_pct) {
        const ret = wasm.model_voxel_mesh_cut(this.__wbg_ptr, cut, nx, ny, nz, constant, wall_mm, top_bottom_mm, infill_pct);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Mesh view of the analysis grid coloured by the last multi-material
     * result: `[hull f32 (9/tri), materialId f32 (3/tri), edges f32]`, cut
     * like `voxel_mesh_cut`. Errors if there is no result yet.
     * @param {boolean} cut
     * @param {number} nx
     * @param {number} ny
     * @param {number} nz
     * @param {number} constant
     * @returns {Array<any>}
     */
    voxel_mesh_mm(cut, nx, ny, nz, constant) {
        const ret = wasm.model_voxel_mesh_mm(this.__wbg_ptr, cut, nx, ny, nz, constant);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
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
     * @param {string} kind
     * @param {boolean} solid_body
     * @returns {Float32Array}
     */
    voxel_result_field(kind, solid_body) {
        const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.model_voxel_result_field(this.__wbg_ptr, ptr0, len0, solid_body);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * Voxel-hull result geometry: the analysis mesh with EXACT nodal
     * displacements (hull vertices ARE grid nodes — no surface sampling
     * like the STL view). With `solid_body` on (Part Topo result active)
     * the hull covers only the RETAINED cells, so the validation fields
     * display on the optimized shape instead of the original envelope —
     * silently full when no solid-topo result exists (defensive: the flag
     * follows UI state). Returns [positions f32 (9/tri), displacements
     * f32 (9/tri), edges f32 (6/segment), edge displacements f32].
     * @param {boolean} solid_body
     * @returns {Array<any>}
     */
    voxel_results(solid_body) {
        const ret = wasm.model_voxel_results(this.__wbg_ptr, solid_body);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) Model.prototype[Symbol.dispose] = Model.prototype.free;

/**
 * Read the manifest (project.json) out of a `.filasim` project file.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function project_manifest(bytes) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.project_manifest(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Extract the embedded original model bytes from a project file.
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
export function project_model(bytes) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.project_model(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * Install the cooperative cancellation flag: an Int32Array over a
 * SharedArrayBuffer whose element 0 the UI thread sets to nonzero while
 * this worker is blocked inside a solve (a postMessage could never arrive
 * mid-call). The MGCG/SIMP loops poll it and bail out with "cancelled".
 * Must be called on the thread that runs the solves (the worker's message
 * loop) — the checker is thread-local.
 * @param {Int32Array} flag
 */
export function set_cancel_flag(flag) {
    wasm.set_cancel_flag(flag);
}

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
 * @param {Int32Array} count
 * @param {Float32Array} data
 */
export function set_progress_buffer(count, data) {
    wasm.set_progress_buffer(count, data);
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_string_get_fa2687d531ed17a5: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_bbadd78c1bac3a77: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_apply_5d99f956e2dda74d: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.apply(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_call_2ad4e88518737145: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            const ret = arg0.call(arg1, arg2, arg3, arg4);
            return ret;
        }, arguments); },
        __wbg_call_c00e41735f66c175: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.call(arg1, arg2, arg3);
            return ret;
        }, arguments); },
        __wbg_call_ec09a4cf93377d3a: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_get_index_09740543571b07e1: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_get_unchecked_46e778e3cec74b5e: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_length_6aa4bccbcf74a0d0: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_fb04d16d7bdf6d4c: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_new_0b303268aa395a38: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_new_from_slice_3a97055a5d361492: function(arg0, arg1) {
            const ret = new Uint32Array(getArrayU32FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_from_slice_a1de2d52c533e16a: function(arg0, arg1) {
            const ret = new Float32Array(getArrayF32FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_from_slice_a41b655474eda3a9: function(arg0, arg1) {
            const ret = new Float64Array(getArrayF64FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_of_00a49fbda9cd82d4: function(arg0, arg1, arg2, arg3, arg4) {
            const ret = Array.of(arg0, arg1, arg2, arg3, arg4);
            return ret;
        },
        __wbg_of_472cbb5aebb61f18: function(arg0, arg1) {
            const ret = Array.of(arg0, arg1);
            return ret;
        },
        __wbg_of_54a6446c1c392a72: function(arg0, arg1, arg2, arg3) {
            const ret = Array.of(arg0, arg1, arg2, arg3);
            return ret;
        },
        __wbg_of_ff6a96997ab2ca9d: function(arg0, arg1, arg2) {
            const ret = Array.of(arg0, arg1, arg2);
            return ret;
        },
        __wbg_push_ceb8ef046afb2041: function(arg0, arg1) {
            const ret = arg0.push(arg1);
            return ret;
        },
        __wbg_set_8f195eacfcc2f2ab: function(arg0, arg1, arg2) {
            arg0.set(getArrayF32FromWasm0(arg1, arg2));
        },
        __wbg_set_index_5bf3e76657ce0baf: function(arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = arg2;
        },
        __wbg_subarray_cad1943533504357: function(arg0, arg1, arg2) {
            const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_warn_8eb4c8081312c9e7: function(arg0, arg1) {
            console.warn(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_cast_0000000000000001: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./filasim_wasm_bg.js": import0,
    };
}

const ModelFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_model_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat32ArrayMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('filasim_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
