# smartMaterialGenerator

A fork of CNC Kitchen's [smartInfillGenerator / filaSim](https://github.com/CNCKitchen/smartInfillGenerator)
(base commit `9f8a4e0`, AGPL-3.0) that adds **multi-material optimization** and
**Fusion simulation import**. Everything runs in the browser (Rust → WASM, voxel FEM,
React + three.js).

> **Status: experimental.** All material values shipped with the multi-material
> feature are test values, not measured data. See [Known limits](#known-limits).

The original filaSim description (single-material infill optimization, export to
OrcaSlicer/Bambu 3MF) is kept in [docs/UPSTREAM-README.md](docs/UPSTREAM-README.md).

## What this fork adds

1. **Multi-material distribution** (N materials, any Poisson ratios). Distributes
   several materials in one part, trading deformation against cracking risk
   (failure index = von Mises stress / effective allowable, with
   `allowable = min(strength, E · allowable strain)`). Budgets limit the share of
   each material (mass or volume fraction). Cost budgets are not implemented yet.
2. **Fusion import.** Drop a Fusion simulation export (`.sdz`) together with the
   STEP file: supports, forces, moments and the study material are mapped onto the
   STEP faces automatically.
3. **Integrated UI.** No separate window: the feature lives in the existing steps
   and reuses the app's own material selector.

## Run it

Requires Node.js 18+. The prebuilt single-threaded WASM is committed in
`web/src/wasm/`, so no Rust toolchain is needed to start.

```sh
git clone -b smartMaterialGenerator https://github.com/lorenzpy/smartMaterialGenerator.git
cd smartMaterialGenerator/web
npm install
npm run dev:st      # http://localhost:5173
```

Use `npm run dev:st`, not `npm run dev`: it leaves out the cross-origin-isolation
service worker (which looks for a multi-threaded WASM build that is not part of
this repository). `npm run build:st` creates the matching production build.

On Windows PowerShell, clone with `git clone -c core.autocrlf=false ...`.

## How to use it

### Choose infill or shape optimization (you control it)

The optimization mode depends on the **material** chosen in step 3 *Properties*:

| Material type | Modes available in step 5 *Optimize* |
|---|---|
| FDM material (PLA, PETG, …) | graded infill, binary (hollow/solid), solid (Part Topo = new shape) |
| Isotropic material (aluminium, Fusion material, …) | solid (Part Topo) only |

An isotropic material removes the infill modes, because they need the print-stack
model of an FDM material. If you get a new shape instead of infill optimization,
check that an FDM material is selected. The Fusion import keeps your selected FDM
material and only adds the Fusion material to the list.

### Multi-material optimization

1. Step 3 *Properties*: select the main material as usual. Under **More materials**,
   click **+ Add another material** for each further material. Each uses the same
   selector as the main material. The library contains a placeholder
   "TPU 95A (Testwert)".
2. Step 5 *Optimize*: with at least one additional material the step shows the
   material distribution: objective weights (deformation vs cracking risk), maximum
   share per material, which material stays at supports and loads, and run
   settings (grid cells, iterations, filter radius, several starts).
3. Run. The result appears in the viewport (one colour per material) with a table
   comparing the optimized design with each single-material part. If a single
   material is better, the optimizer returns that one.

Settings are stored per browser and inside saved projects (older projects still
open unchanged).

### Fusion import

Load the `.sdz` and the matching `.step` together (top bar or drop both files).
Face matching uses plane/cylinder geometry. Check the imported supports and forces
in step 2 before running anything. Tested with one sample file only.

## Known limits

- **Test values.** Material data (including TPU 95A) are placeholders. Replace them
  with measured values in ⚙ Settings.
- **Often no useful mixed design.** In force-controlled load cases a stiff single
  material usually wins. A clear advantage appeared only with imposed deformation
  (e.g. a short TPU hinge in series with a stiff spring); displacement-controlled
  and multi-load cases are not implemented.
- **Slow.** Single-threaded WASM: roughly 10 s per iteration at 2500 cells.
- **Linear elastic.** Soft materials at large strain are approximate.
- **No multi-material 3MF export** for slicers yet.
- Only tested on Linux/Chromium; Windows start steps are untested.

## Repo layout

```
crates/filasim-core    Rust engine (voxel FEM, multigrid, SIMP, and in this fork:
                       materials.rs, threshold.rs, mmopt.rs, mmgen.rs)
crates/filasim-wasm    wasm-bindgen API (mm_run, mm_region_* added)
web/                   Vite + React + three.js app
web/src/engine/sdz/    .sdz reader (ZIP + ACIS faces) and face matching
web/src/mm/            multi-material settings and types
web/src/ui/MultiMaterial.tsx   material mix and Optimize-step UI
docs/                  theory and verification manuals (upstream) + notes
```

## Development

```sh
cargo test -p filasim-core                      # incl. multi-material tests
cd web && npm run wasm:st                       # rebuild WASM (needs Rust + wasm-pack)
cd web && npm run build:st                      # production build
cd web && npm run check:sdz                     # .sdz import check
```

`web/src/wasm/` is tracked in this fork. After `wasm:st` it shows up as changed;
commit it if you changed Rust code.

## License

**AGPL-3.0-only**, see [LICENSE](LICENSE). This is a modified version of filaSim by
CNC Kitchen. If you distribute it or offer it over a network, the complete source
must be available under the same terms. Commercial use inside closed-source
software requires an exception from the original author, see
[COMMERCIAL.md](COMMERCIAL.md). Do not use the "filaSim" name for a public fork.
