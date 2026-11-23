// SPDX-License-Identifier: AGPL-3.0-only
// Multi-material fork: the multi-material controls inside the normal steps.
//  - MaterialMixGroup: part of the Properties step — which library materials
//    take part in the part and how much of each at most.
//  - StepOptimizeMulti: the Optimize step when several materials are in use —
//    objectives, grid, run, result.

import { useShallow } from "zustand/shallow";
import { mmMix, useStore } from "../store";
import { isIsotropic, type Material } from "../types";
import { mmColor } from "../mm/types";
import { NumInput } from "./NumInput";
import { Section } from "./Section";
import { format } from "../units";

/** Failure limit the optimizer uses for a library material, in MPa. */
function stressLimit(m: Material): number {
  return isIsotropic(m) ? m.yieldStrength : m.strength;
}

/** Same selector as the Properties step's material: the library list in the
 *  same groups, the same value line, the same "edit" link. */
function MaterialPicker({
  value,
  materials,
  onChange,
  onRemove,
  onEdit,
  dot,
}: {
  value: Material;
  materials: Material[];
  onChange: (name: string) => void;
  onRemove: () => void;
  onEdit: () => void;
  dot: string;
}) {
  const iso = isIsotropic(value);
  return (
    <div className="mmpick">
      <div className="mmpickrow">
        <i className="mmdot" style={{ background: dot }} />
        <select value={value.name} onChange={(e) => onChange(e.target.value)}>
          <optgroup label="FDM (printed)">
            {materials.filter((m) => !isIsotropic(m)).map((m) => (
              <option key={m.name}>{m.name}</option>
            ))}
          </optgroup>
          <optgroup label="Isotropic (machined / cast / resin)">
            {materials.filter((m) => isIsotropic(m)).map((m) => (
              <option key={m.name}>{m.name}</option>
            ))}
          </optgroup>
        </select>
        <button className="ghost" onClick={onRemove} title="Remove this material from the mix" aria-label="Remove material">
          ×
        </button>
      </div>
      <div className="dim small">
        E = {format(value.e0, "modulus")} · ν = {value.nu} · ρ = {format(value.density, "density")} ·{" "}
        {iso ? `σy = ${format(value.yieldStrength, "stress")}` : `σₜ = ${format(value.strength, "stress")}`} —{" "}
        <a className="link" onClick={onEdit}>
          edit
        </a>
      </div>
    </div>
  );
}

/** Properties step: more materials for the same part, chosen with the same
 *  material selector as the part's own material (which stays the first one). */
export function MaterialMixGroup() {
  const s = useStore(
    useShallow((s) => ({
      mm: s.mm,
      setMm: s.setMm,
      material: s.material,
      materials: s.materials,
      openMaterialsManager: s.openMaterialsManager,
    }))
  );
  const mix = mmMix(s.material, s.materials, s.mm.names);
  const extras = mix.slice(1);
  const free = s.materials.find((m) => !mix.some((x) => x.name === m.name));
  const setExtras = (names: string[]) => s.setMm({ names });
  return (
    <div className="group">
      <div className="g-label">
        <span>More materials</span>
        <b>{extras.length > 0 ? `${mix.length} in mix` : "single material"}</b>
      </div>
      {extras.map((m, i) => (
        <MaterialPicker
          key={`${i}-${m.name}`}
          value={m}
          materials={s.materials}
          dot={mmColor(i + 1)}
          onChange={(name) => setExtras(extras.map((x, k) => (k === i ? name : x.name)))}
          onRemove={() => setExtras(extras.filter((_, k) => k !== i).map((x) => x.name))}
          onEdit={() => s.openMaterialsManager(true)}
        />
      ))}
      <button
        className="ghost"
        disabled={!free}
        onClick={() => free && setExtras([...extras.map((x) => x.name), free.name])}
        title="Use a second (third, …) material in the same part"
      >
        + Add another material
      </button>
      {extras.length > 0 && (
        <div className="dim small">
          <i className="mmdot" style={{ background: mmColor(0) }} /> {s.material.name}
          {extras.map((m, i) => (
            <span key={m.name}>
              {"  "}
              <i className="mmdot" style={{ background: mmColor(i + 1) }} /> {m.name}
            </span>
          ))}
          . The Optimize step decides where each one goes.
        </div>
      )}
    </div>
  );
}

function pct(x: number) {
  return `${(100 * x).toFixed(1)} %`;
}

export function StepOptimizeMulti() {
  const s = useStore(
    useShallow((s) => ({
      mm: s.mm,
      setMm: s.setMm,
      material: s.material,
      materials: s.materials,
      mmRun: s.mmRun,
      runMultiMaterial: s.runMultiMaterial,
      clearMultiMaterial: s.clearMultiMaterial,
      busy: s.busy,
      setActiveStep: s.setActiveStep,
      bcs: s.bcs,
    }))
  );
  const { mm, mmRun } = s;
  const mats = mmMix(s.material, s.materials, mm.names);
  const ready = mats.length >= 2 && s.bcs.some((b) => b.tris.length > 0);
  const sum = mmRun.summary;
  return (
    <>
      <Section title="Material distribution" defaultOpen badge={mats.length >= 2 ? `${mats.length} materials` : "add a material"}>
        {mats.length < 2 ? (
          <p className="hint">
            Add a second material in the{" "}
            <a className="link" onClick={() => s.setActiveStep(3)}>
              Properties
            </a>{" "}
            step first.
          </p>
        ) : (
          <>
            <div className="group">
              <div className="g-label">
                <span>Objective</span>
              </div>
              <div className="duo">
                <div className="group">
                  <div className="g-label">
                    <span>Deformation</span>
                  </div>
                  <NumInput value={mm.wCompliance} step={0.1} min={0} onCommit={(v) => s.setMm({ wCompliance: v })} />
                </div>
                <div className="group">
                  <div className="g-label">
                    <span>Cracking risk</span>
                  </div>
                  <NumInput value={mm.wRisk} step={0.1} min={0} onCommit={(v) => s.setMm({ wRisk: v })} />
                </div>
              </div>
              <div className="dim small">
                Weights of the two goals, each normalized by its value at the start. 1 : 0 = stiffest design, 0 : 1 = least
                cracking risk. The failure limits come from each material (strength and strain at rupture).
              </div>
            </div>
            <div className="group">
              <div className="g-label">
                <span>Maximum share per material</span>
                <b>% of volume</b>
              </div>
              {mats.map((m, i) => (
                <div key={m.name} className="mmrow">
                  <span className="check">
                    <i className="mmdot" style={{ background: mmColor(i) }} />
                    <span>{m.name}</span>
                  </span>
                  <input
                    className="mmpct"
                    type="number"
                    min={0}
                    max={100}
                    placeholder="–"
                    value={mm.maxPercent[m.name] ?? ""}
                    onChange={(e) => s.setMm({ maxPercent: { ...mm.maxPercent, [m.name]: e.target.value } })}
                  />
                </div>
              ))}
            </div>
            <div className="group">
              <div className="g-label">
                <span>Material at supports and loads</span>
              </div>
              <select value={mm.keepName || mats[0].name} onChange={(e) => s.setMm({ keepName: e.target.value })}>
                {mats.map((m) => (
                  <option key={m.name}>{m.name}</option>
                ))}
              </select>
            </div>
          </>
        )}
      </Section>

      {mats.length >= 2 && (
        <Section title="Run settings" badge={`${mm.cells} cells · ${mm.maxIter} it`}>
          <div className="duo">
            <div className="group">
              <div className="g-label">
                <span>Grid cells</span>
              </div>
              <NumInput value={mm.cells} step={500} min={500} max={60000} onCommit={(v) => s.setMm({ cells: v })} />
            </div>
            <div className="group">
              <div className="g-label">
                <span>Iterations</span>
              </div>
              <NumInput value={mm.maxIter} step={10} min={5} max={1000} onCommit={(v) => s.setMm({ maxIter: v })} />
            </div>
          </div>
          <div className="dim small">
            The optimizer solves twice per iteration and uses its own coarse grid (not the analysis resolution), so keep the
            cell count small. Start with 1500 to 3000 cells.
          </div>
          <div className="duo">
            <div className="group">
              <div className="g-label">
                <span>Filter radius (cells)</span>
              </div>
              <NumInput value={mm.filterRadius} step={0.5} min={1} max={4} onCommit={(v) => s.setMm({ filterRadius: v })} />
            </div>
            <label className="checkrow" title="Also optimize from every single material and keep the best design (slower, more robust)">
              <input type="checkbox" checked={mm.multiStart} onChange={(e) => s.setMm({ multiStart: e.target.checked })} />
              <span>Several starts</span>
            </label>
          </div>
        </Section>
      )}

      <div className="group">
        <button
          className="primary"
          disabled={!ready || mmRun.running || !!s.busy}
          onClick={() => void s.runMultiMaterial()}
          title={ready ? "Distribute the materials" : "Needs a second material, a support and a load"}
        >
          {mmRun.running ? "Running…" : "Optimize material distribution"}
        </button>
        {!s.bcs.some((b) => b.tris.length > 0) && (
          <div className="hint">
            Set supports and loads in the{" "}
            <a className="link" onClick={() => s.setActiveStep(2)}>
              Loads
            </a>{" "}
            step first.
          </div>
        )}
        {mmRun.running && mmRun.progress && (
          <div className="dim small" data-testid="mm-progress">
            iteration {mmRun.progress.iteration} · deformation {mmRun.progress.compliance.toPrecision(4)} · risk{" "}
            {mmRun.progress.risk.toPrecision(4)}
          </div>
        )}
        {mmRun.error && <div className="hint">{mmRun.error}</div>}
      </div>

      {sum && (
        <Section title="Result" defaultOpen badge={mmRun.stale ? "outdated" : sum.chosen.replace(/ \(.*\)$/, "")}>
          <div data-testid="mm-result">
            {mmRun.stale && <div className="hint">Loads, supports or materials changed since this run — run it again.</div>}
            <div className="mmlegend">
              {sum.materials.map((n, i) => (
                <span key={n} className="mmchip">
                  <i className="mmdot" style={{ background: mmRun.colors[n] ?? mmColor(i) }} />
                  {n} {pct(sum.volumeFractions[i] ?? 0)}
                </span>
              ))}
            </div>
            <table className="mmtable">
              <thead>
                <tr>
                  <th>design</th>
                  <th title="largest nodal displacement">max disp</th>
                  <th title="largest failure index; > 1 = a limit is exceeded">risk max</th>
                  <th>cells &gt; 1</th>
                </tr>
              </thead>
              <tbody>
                {sum.baselines.map((b) => (
                  <tr key={b.label}>
                    <td>{b.label}</td>
                    <td>{format(b.maxDisp, "length")}</td>
                    <td>{b.riskMax.toFixed(2)}</td>
                    <td>{b.failing}</td>
                  </tr>
                ))}
                <tr className="opt">
                  <td>chosen</td>
                  <td>{format(sum.maxDisp, "length")}</td>
                  <td>{sum.riskMax.toFixed(2)}</td>
                  <td>{sum.failing}</td>
                </tr>
              </tbody>
            </table>
            <div className="dim small">
              {sum.chosen}. {sum.iterations} iterations ({sum.converged ? "converged" : "not converged"}),{" "}
              {sum.seconds.toFixed(0)} s, mass {sum.massG.toFixed(2)} g. Linear elastic field; soft materials at large strain
              are approximate.
            </div>
            <button className="ghost" onClick={() => s.clearMultiMaterial()}>
              Clear result
            </button>
          </div>
        </Section>
      )}
    </>
  );
}
