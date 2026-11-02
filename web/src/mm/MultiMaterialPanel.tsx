// SPDX-License-Identifier: AGPL-3.0-only
// Multi-material fork: floating panel to define materials, run the general
// multi-material optimizer and read the result. The viewport shows one colored
// surface per material (clip it with the normal section plane).

import { useMm } from "./mmStore";
import type { MmSummary } from "./types";

const num = (v: string, fallback: number) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
};

function Field(props: { label: string; value: number | string; step?: string; onChange: (v: string) => void; w?: number; title?: string }) {
  return (
    <label className="mm-field" title={props.title}>
      <span>{props.label}</span>
      <input type="number" step={props.step ?? "any"} value={props.value} style={{ width: props.w ?? 70 }} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}

function pct(x: number) {
  return `${(100 * x).toFixed(1)} %`;
}

function Result({ s, colors }: { s: MmSummary; colors: string[] }) {
  const rows = [
    ...s.baselines.map((b) => ({ name: b.label, d: b.maxDisp, r: b.riskMax, rp: b.riskP, f: b.failing, opt: false })),
    { name: `chosen: ${s.chosen}`, d: s.maxDisp, r: s.riskMax, rp: s.riskP, f: s.failing, opt: true },
  ];
  return (
    <div className="mm-result" data-testid="mm-result">
      <div className="mm-legend">
        {s.materials.map((n, i) => (
          <span key={n} className="mm-chip">
            <i style={{ background: colors[i] }} />
            {n} {pct(s.volumeFractions[i] ?? 0)}
          </span>
        ))}
      </div>
      <table>
        <thead>
          <tr>
            <th>design</th>
            <th title="largest nodal displacement">max disp (mm)</th>
            <th title="largest failure index; > 1 = a limit is exceeded">risk max</th>
            <th title="volume-weighted p-norm of the failure index">risk p-norm</th>
            <th>cells &gt; 1</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className={r.opt ? "opt" : ""}>
              <td>{r.name}</td>
              <td>{r.d.toFixed(3)}</td>
              <td>{r.r.toFixed(3)}</td>
              <td>{r.rp.toFixed(3)}</td>
              <td>{r.f}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mm-note">
        {s.iterations} iterations ({s.converged ? "converged" : "not converged"}), {s.seconds.toFixed(1)} s, mass {s.massG.toFixed(2)} g.
        Values use the linear elastic field; soft materials at large strain are approximate.
      </div>
    </div>
  );
}

export function MultiMaterialPanel() {
  const m = useMm();
  const model = m.materials;
  return (
    <>
      <button className="mm-toggle" data-testid="mm-toggle" onClick={() => m.setOpen(!m.open)} title="Multi-material optimization">
        Multi-Material
      </button>
      {m.open && (
        <div className="mm-panel" data-testid="mm-panel">
          <div className="mm-head">
            <b>Multi-Material optimization</b>
            <button onClick={() => m.setOpen(false)} aria-label="Close">
              ×
            </button>
          </div>
          <div className="mm-sub">
            Uses the loads and supports set up in the normal steps. Material values below are <b>test values</b>.
          </div>

          <div className="mm-sec">Materials</div>
          {model.map((mat, i) => (
            <div key={i} className="mm-mat">
              <input type="color" value={mat.color} onChange={(e) => m.setMaterial(i, { color: e.target.value })} />
              <input className="mm-name" value={mat.name} onChange={(e) => m.setMaterial(i, { name: e.target.value })} />
              <Field label="E MPa" value={mat.e} onChange={(v) => m.setMaterial(i, { e: num(v, mat.e) })} w={64} />
              <Field label="ν" value={mat.nu} step="0.01" onChange={(v) => m.setMaterial(i, { nu: Math.min(0.49, Math.max(0, num(v, mat.nu))) })} w={52} />
              <Field label="ρ g/cm³" value={mat.density} step="0.01" onChange={(v) => m.setMaterial(i, { density: num(v, mat.density) })} w={56} />
              <Field label="σ lim MPa" value={mat.stressAllow} title="allowable von Mises stress (0 = no limit)" onChange={(v) => m.setMaterial(i, { stressAllow: num(v, mat.stressAllow) })} w={56} />
              <Field label="ε lim" value={mat.strainAllow} step="0.005" title="allowable strain (0 = no limit)" onChange={(v) => m.setMaterial(i, { strainAllow: num(v, mat.strainAllow) })} w={56} />
              <Field label="max %" value={m.maxPercent[i] ?? ""} title="upper bound on this material's volume share (blank = none)" onChange={(v) => m.update({ maxPercent: m.maxPercent.map((x, k) => (k === i ? v : x)) })} w={44} />
              <button onClick={() => m.removeMaterial(i)} disabled={model.length <= 2} title="Remove">
                −
              </button>
            </div>
          ))}
          <button onClick={m.addMaterial}>+ material</button>

          <div className="mm-sec">Objective (weights)</div>
          <div className="mm-row">
            <Field label="deformation (stiffness)" value={m.wCompliance} step="0.1" onChange={(v) => m.update({ wCompliance: Math.max(0, num(v, m.wCompliance)) })} />
            <Field label="failure risk (cracking)" value={m.wRisk} step="0.1" onChange={(v) => m.update({ wRisk: Math.max(0, num(v, m.wRisk)) })} />
          </div>
          <div className="mm-hint">Both terms are normalized by their value at the start, so the weights are comparable. 1 : 0 = stiffest, 0 : 1 = least cracking.</div>

          <div className="mm-sec">Settings</div>
          <div className="mm-row">
            <Field label="cells" value={m.cells} step="500" title="analysis resolution; keep small, each iteration solves twice" onChange={(v) => m.update({ cells: Math.max(500, Math.min(60000, num(v, m.cells))) })} />
            <Field label="iterations" value={m.maxIter} step="10" onChange={(v) => m.update({ maxIter: Math.max(5, Math.min(1000, num(v, m.maxIter))) })} />
            <Field label="filter (cells)" value={m.filterRadius} step="0.5" onChange={(v) => m.update({ filterRadius: Math.max(1, Math.min(4, num(v, m.filterRadius))) })} />
            <label className="mm-field" title="also optimize from every single material and keep the best design (slower, more robust: the problem has local optima)">
              <span>several starts</span>
              <input type="checkbox" checked={m.multiStart} onChange={(e) => m.update({ multiStart: e.target.checked })} />
            </label>
            <label className="mm-field">
              <span>keep at supports</span>
              <select value={m.keepMaterial} onChange={(e) => m.update({ keepMaterial: Number(e.target.value) })}>
                {model.map((x, i) => (
                  <option key={i} value={i}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mm-row">
            <button className="primary" data-testid="mm-run" disabled={m.running} onClick={() => void m.run()}>
              {m.running ? "Running…" : "Run optimization"}
            </button>
            <button onClick={m.clear} disabled={m.running || (!m.summary && !m.error)}>
              Clear result
            </button>
          </div>
          {m.running && m.progress && (
            <div className="mm-progress" data-testid="mm-progress">
              iteration {m.progress.iteration} · penalty {m.progress.penalty.toFixed(1)} · deformation {m.progress.compliance.toPrecision(4)} · risk {m.progress.risk.toPrecision(4)}
            </div>
          )}
          {m.error && <div className="mm-error">{m.error}</div>}
          {m.summary && <Result s={m.summary} colors={model.map((x) => x.color)} />}
        </div>
      )}
    </>
  );
}
