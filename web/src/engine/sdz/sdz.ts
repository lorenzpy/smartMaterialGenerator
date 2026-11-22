// SPDX-License-Identifier: AGPL-3.0-only
// Multi-material fork: reader for Autodesk Fusion simulation exports (.sdz).
//
// A .sdz is a ZIP holding `project.json` (the study: material, loads,
// constraints, and which CAD faces they attach to) and the body as an ACIS/ASM
// .sat file. We do NOT tessellate the .sat: the geometry comes from the STEP
// file the user loads with it (filaSim already imports STEP with CAD-face ids).
// From the .sat we read only the surface definition (plane / cylinder / cone)
// and the corner points of the faces the study refers to, so those faces can be
// found again on the STEP mesh by geometry (matchFaces).

import { readZip } from "./zip.ts";

export type Vec3 = [number, number, number];

export interface SdzMaterial {
  name: string;
  /** MPa */
  e0: number;
  nu: number;
  /** g/cm³ */
  density: number;
  /** MPa; 0 when the file has none */
  yieldStrength: number;
  tensileStrength: number;
  /** 1/K, undefined when absent */
  cte?: number;
}

export interface SdzLoad {
  kind: "force" | "moment";
  name: string;
  /** N for forces, N·m for moments (SI, as stored by Fusion). */
  magnitude: number;
  /** Unit direction in the model frame. */
  dir: Vec3;
  perEntity: boolean;
  actAlongNormal: boolean;
  /** ACIS face numbers (position in the body's face list). */
  faces: number[];
}

export interface SdzConstraint {
  name: string;
  type: string;
  /** [UX, UY, UZ, RX, RY, RZ]: true = fixed. */
  fixed: boolean[];
  faces: number[];
}

export type SatKind = "plane" | "cylinder" | "cone" | "spline" | "other";

export interface SatFace {
  index: number;
  kind: SatKind;
  sense: string;
  /** mm */
  root?: Vec3;
  /** Unit plane normal / cylinder axis. */
  axis?: Vec3;
  radius?: number;
  /** Corner-point bounding box, mm. */
  bboxLo: Vec3;
  bboxHi: Vec3;
}

export interface SdzSetup {
  studyName: string;
  material: SdzMaterial | null;
  loads: SdzLoad[];
  constraints: SdzConstraint[];
  /** Gravity as stored (m/s², unit direction), when the study has it. */
  gravity: { magnitude: number; dir: Vec3 } | null;
  /** Everything we saw but do not apply, in plain words. */
  ignored: string[];
  /** Geometry of the faces the study refers to, by ACIS face number. */
  faces: Map<number, SatFace>;
  /** Total number of faces in the body (for the consistency check). */
  faceCount: number;
}

// ---------------------------------------------------------------------------
// project.json
// ---------------------------------------------------------------------------

interface JObj {
  type: string;
  id: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: unknown } | undefined>;
}

const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);

function relIds(o: JObj, key: string): string[] {
  const d = o.relationships?.[key]?.data;
  if (Array.isArray(d)) return d.map((x) => str((x as { id?: unknown }).id)).filter(Boolean);
  if (d && typeof d === "object") {
    const id = str((d as { id?: unknown }).id);
    return id ? [id] : [];
  }
  return [];
}

export async function parseSdz(bytes: ArrayBuffer): Promise<SdzSetup> {
  const entries = readZip(bytes);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const proj = byName.get("project.json");
  if (!proj) throw new Error("this .sdz has no project.json — not a Fusion simulation export");
  const doc = JSON.parse(new TextDecoder().decode(await proj.read())) as { data?: JObj[] };
  const data = doc.data ?? [];
  const byId = new Map(data.map((o) => [o.id, o]));
  const ofType = (t: string) => data.filter((o) => o.type === t);
  const ignored: string[] = [];

  // --- geometry file ---
  const geom = ofType("Geometry")[0];
  const fileIds = geom ? relIds(geom, "externalfiles") : [];
  let satText: string | null = null;
  for (const id of fileIds) {
    const e = byName.get(`${id}.sat`) ?? byName.get(`${id}.file.sat`);
    if (e) {
      satText = new TextDecoder("latin1").decode(await e.read());
      break;
    }
  }
  if (!satText) {
    const any = entries.find((e) => /\.sat$/i.test(e.name));
    if (any) satText = new TextDecoder("latin1").decode(await any.read());
  }

  // --- face assignments: attribute id -> ACIS face numbers ---
  const facesOf = new Map<string, number[]>();
  const bodyAttrs = new Set<string>();
  for (const aga of ofType("AttributeGeometryAssignment")) {
    const attrId = str(aga.attributes?.AttributeId);
    for (const grId of relIds(aga, "geometryreferences")) {
      const gr = byId.get(grId);
      const t = str(gr?.attributes?.Type);
      const gid = num(gr?.attributes?.GeometryComponentId, -1);
      if (t === "Surface" && gid >= 0) {
        facesOf.set(attrId, [...(facesOf.get(attrId) ?? []), gid]);
      } else if (t === "Body") {
        bodyAttrs.add(attrId);
      } else if (t) {
        ignored.push(`Zuordnung zu "${t}" (nicht unterstützt, nur Flächen und Körper)`);
      }
    }
  }

  // --- material ---
  let material: SdzMaterial | null = null;
  const mats = ofType("Material");
  const matObj = mats.find((m) => bodyAttrs.has(m.id)) ?? mats[0];
  if (matObj) {
    const mech = relIds(matObj, "mechanical").map((i) => byId.get(i)).filter(Boolean) as JObj[];
    let iso: JObj | undefined;
    for (const m of mech) {
      for (const k of Object.keys(m.relationships ?? {})) {
        for (const cid of relIds(m, k)) {
          const c = byId.get(cid);
          if (c?.type === "MaterialMechanicalBehaviorIsotropic") iso = c;
        }
      }
    }
    iso = iso ?? ofType("MaterialMechanicalBehaviorIsotropic")[0];
    const metal = relIds(matObj, "specific").map((i) => byId.get(i))[0] ?? ofType("MaterialSpecificMetal")[0];
    const therm = ofType("MaterialThermalBehaviorIsotropic")[0];
    const thermParent = relIds(matObj, "thermal").map((i) => byId.get(i))[0] ?? ofType("MaterialThermal")[0];
    if (iso) {
      material = {
        name: str(matObj.attributes?.EnglishName) || str(matObj.attributes?.Name, "Fusion material"),
        e0: num(iso.attributes?.YoungModulus) / 1e6, // Pa -> MPa
        nu: num(iso.attributes?.PoissonRatio, 0.3),
        density: num(iso.attributes?.Density) / 1000, // kg/m³ -> g/cm³
        yieldStrength: num(metal?.attributes?.YieldStrength) / 1e6,
        tensileStrength: num(metal?.attributes?.TensileStrength) / 1e6,
        cte: thermParent ? num(thermParent.attributes?.ExpansionCoeficient, NaN) : undefined,
      };
      if (!(material.e0 > 0)) material = null;
      if (material && !Number.isFinite(material.cte ?? NaN)) material.cte = undefined;
      void therm;
    }
  }

  const vec = (o: JObj): Vec3 => {
    const v = byId.get(relIds(o, "directionunitvector")[0] ?? "");
    const x: Vec3 = [num(v?.attributes?.X), num(v?.attributes?.Y), num(v?.attributes?.Z)];
    const L = Math.hypot(x[0], x[1], x[2]);
    return L > 0 ? [x[0] / L, x[1] / L, x[2] / L] : [0, 0, 0];
  };

  // --- loads (the attribute ids of AttributeGeometryAssignment are the load ids) ---
  const loads: SdzLoad[] = [];
  let gravity: SdzSetup["gravity"] = null;
  for (const o of data) {
    const lt = str(o.attributes?.LoadType);
    if (o.type === "ForceLoad" || lt === "Force") {
      loads.push({
        kind: "force",
        name: str(o.attributes?.Name, "Force"),
        magnitude: num(o.attributes?.Magnitude),
        dir: vec(o),
        perEntity: o.attributes?.PerEntity === true,
        actAlongNormal: o.attributes?.ActAlongNormal === true,
        faces: facesOf.get(o.id) ?? [],
      });
    } else if (o.type === "MomentLoad" || lt === "Moment") {
      loads.push({
        kind: "moment",
        name: str(o.attributes?.Name, "Moment"),
        magnitude: num(o.attributes?.Magnitude),
        dir: vec(o),
        perEntity: false,
        actAlongNormal: false,
        faces: facesOf.get(o.id) ?? [],
      });
    } else if (o.type === "LinearAcceleration") {
      gravity = { magnitude: num(o.attributes?.Magnitude), dir: vec(o) };
    } else if (o.type === "GravityLoad") {
      // a template object without load case when IsOn is false — nothing to apply
    } else if (str(o.attributes?.Type) === "Load" && o.type !== "GravityLoad") {
      ignored.push(`Lasttyp "${lt || o.type}" (${str(o.attributes?.Name, "ohne Namen")}) wird nicht unterstützt`);
    }
  }
  const constraints: SdzConstraint[] = [];
  for (const o of ofType("Constraint")) {
    const flag = (k: string) => str(o.attributes?.[k]) === "Fixed";
    constraints.push({
      name: str(o.attributes?.Name, "Constraint"),
      type: str(o.attributes?.ConstraintType),
      fixed: ["UX", "UY", "UZ", "RX", "RY", "RZ"].map(flag),
      faces: facesOf.get(o.id) ?? [],
    });
  }
  const studyName = str(ofType("ProjectSimulation")[0]?.attributes?.Name, "Fusion study");

  // --- geometry of the referenced faces ---
  const wanted = new Set<number>();
  for (const l of loads) l.faces.forEach((f) => wanted.add(f));
  for (const c of constraints) c.faces.forEach((f) => wanted.add(f));
  let faces = new Map<number, SatFace>();
  let faceCount = 0;
  if (satText) {
    const r = parseSatFaces(satText, wanted);
    faces = r.faces;
    faceCount = r.faceCount;
  } else {
    ignored.push("Die .sdz enthält keine .sat-Geometrie: Flächen können nicht zugeordnet werden");
  }
  return { studyName, material, loads, constraints, gravity, ignored, faces, faceCount };
}

// ---------------------------------------------------------------------------
// ACIS / ASM .sat (text) — only what the face matching needs
// ---------------------------------------------------------------------------

const refOf = (t: string | undefined): number => (t && t.startsWith("$") ? Number(t.slice(1)) : -1);

export function parseSatFaces(text: string, wanted: Set<number>): { faces: Map<number, SatFace>; faceCount: number } {
  const lines = text.split("\n");
  // Header line 3: "<mm per model unit> <resabs> <resnor>"
  const scale = Number(lines[2]?.trim().split(/\s+/)[0]) || 1;
  const body = lines.slice(3).join("\n");
  const R: string[][] = body
    .split("#")
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const t = r.split(/\s+/);
      // optional "-N" record index prefix
      return /^-\d+$/.test(t[0]) && t.length > 1 && /^[a-z]/i.test(t[1]) ? t.slice(1) : t;
    });
  const type = (i: number) => (i >= 0 && i < R.length ? R[i][0] : "");

  // face order: follow the shell's face chain, fall back to file order
  const order: number[] = [];
  const shell = R.findIndex((t) => t[0] === "shell");
  let f = shell >= 0 ? refOf(R[shell][6]) : -1;
  const seen = new Set<number>();
  while (f >= 0 && type(f) === "face" && !seen.has(f)) {
    seen.add(f);
    order.push(f);
    f = refOf(R[f][4]);
  }
  if (order.length === 0) R.forEach((t, i) => t[0] === "face" && order.push(i));

  const faces = new Map<number, SatFace>();
  for (const idx of wanted) {
    const fi = order[idx];
    if (fi === undefined) continue;
    const ft = R[fi];
    // surface reference: the first $ref pointing at a "*-surface" record
    let sref = refOf(ft[8]);
    if (!type(sref).endsWith("-surface")) {
      sref = ft.map(refOf).find((r) => r >= 0 && type(r).endsWith("-surface")) ?? -1;
    }
    const st = sref >= 0 ? R[sref] : [];
    const sense = ft[9] ?? "forward";
    const n3 = (o: number): Vec3 => [Number(st[o]) * scale, Number(st[o + 1]) * scale, Number(st[o + 2]) * scale];
    const unit = (v: Vec3): Vec3 => {
      const L = Math.hypot(v[0], v[1], v[2]) || 1;
      return [v[0] / L, v[1] / L, v[2] / L];
    };
    let kind: SatKind = "other";
    let root: Vec3 | undefined;
    let axis: Vec3 | undefined;
    let radius: number | undefined;
    if (st[0] === "plane-surface") {
      kind = "plane";
      root = n3(4);
      axis = unit([Number(st[7]), Number(st[8]), Number(st[9])]);
    } else if (st[0] === "cone-surface") {
      const major = [Number(st[10]) * scale, Number(st[11]) * scale, Number(st[12]) * scale];
      const ratio = Number(st[13]);
      const sinHalf = Number(st[16]);
      root = n3(4);
      axis = unit([Number(st[7]), Number(st[8]), Number(st[9])]);
      radius = Math.hypot(major[0], major[1], major[2]);
      kind = Math.abs(ratio - 1) < 1e-6 && Math.abs(sinHalf) < 1e-9 ? "cylinder" : Math.abs(ratio - 1) < 1e-6 ? "cone" : "other";
    } else if (st[0] === "spline-surface") {
      kind = "spline";
    }
    // corner points -> bounding box
    const lo: Vec3 = [Infinity, Infinity, Infinity];
    const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    let loop = refOf(ft[5]);
    const seenLoops = new Set<number>();
    while (loop >= 0 && type(loop) === "loop" && !seenLoops.has(loop)) {
      seenLoops.add(loop);
      const c0 = refOf(R[loop][5]);
      let c = c0;
      const seenC = new Set<number>();
      while (c >= 0 && type(c) === "coedge" && !seenC.has(c)) {
        seenC.add(c);
        const e = refOf(R[c][7]);
        if (type(e) === "edge") {
          for (const vtok of [R[e][4], R[e][6]]) {
            const v = refOf(vtok);
            const p = type(v) === "vertex" ? refOf(R[v][5]) : -1;
            if (type(p) === "point") {
              for (let d = 0; d < 3; d++) {
                const x = Number(R[p][4 + d]) * scale;
                lo[d] = Math.min(lo[d], x);
                hi[d] = Math.max(hi[d], x);
              }
            }
          }
        }
        c = refOf(R[c][4]);
        if (c === c0) break;
      }
      loop = refOf(R[loop][4]);
    }
    faces.set(idx, { index: idx, kind, sense, root, axis, radius, bboxLo: lo, bboxHi: hi });
  }
  return { faces, faceCount: order.length };
}

// ---------------------------------------------------------------------------
// SAT face -> STEP face (dense index of filaSim's CAD-face list)
// ---------------------------------------------------------------------------

/** What filaSim knows about each STEP face (subset of StepFaceInfo). */
export interface StepFaceLike {
  type: string;
  origin?: Vec3;
  axis?: Vec3;
  radius?: number;
}

export interface FaceMatch {
  /** Dense STEP face index. */
  dense: number;
  how: string;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

/** Find the STEP face for every requested SAT face. Planes and cylinders match
 *  by their exact definition (and the face number when several candidates
 *  remain); free-form faces only by face number, and only when both files list
 *  the same number of faces. Faces that cannot be matched are reported. */
export function matchFaces(
  sat: Map<number, SatFace>,
  satFaceCount: number,
  step: StepFaceLike[],
  tolMm = 5e-3
): { matches: Map<number, FaceMatch>; problems: string[] } {
  const matches = new Map<number, FaceMatch>();
  const problems: string[] = [];
  for (const [idx, sf] of sat) {
    const cands: number[] = [];
    step.forEach((s, d) => {
      if (sf.kind === "plane" && s.type === "plane" && s.origin && s.axis && sf.root && sf.axis) {
        const parallel = Math.abs(Math.abs(dot(s.axis, sf.axis)) - 1) < 1e-6;
        if (parallel && Math.abs(dot(sf.axis, sub(s.origin, sf.root))) < tolMm) cands.push(d);
      } else if (
        (sf.kind === "cylinder" || sf.kind === "cone") &&
        s.type === (sf.kind === "cylinder" ? "cylinder" : "cone") &&
        s.origin && s.axis && sf.root && sf.axis && s.radius !== undefined && sf.radius !== undefined
      ) {
        const parallel = Math.abs(Math.abs(dot(s.axis, sf.axis)) - 1) < 1e-6;
        const off = sub(s.origin, sf.root);
        const along = dot(off, sf.axis);
        const perp = norm([off[0] - along * sf.axis[0], off[1] - along * sf.axis[1], off[2] - along * sf.axis[2]]);
        if (parallel && perp < tolMm && (sf.kind === "cone" || Math.abs(s.radius - sf.radius) < tolMm)) cands.push(d);
      }
    });
    if (sf.kind === "spline" || (sf.kind === "other" && cands.length === 0)) {
      if (step.length === satFaceCount && step[idx]?.type === "bspline") {
        matches.set(idx, { dense: idx, how: "Freiformfläche über die Flächennummer (beide Dateien haben gleich viele Flächen)" });
      } else {
        problems.push(`Fläche ${idx}: Freiformfläche lässt sich nicht sicher zuordnen`);
      }
      continue;
    }
    if (cands.length === 1) matches.set(idx, { dense: cands[0], how: "über die Flächengeometrie" });
    else if (cands.length > 1 && cands.includes(idx)) matches.set(idx, { dense: idx, how: "Geometrie und Flächennummer" });
    else if (cands.length > 1) problems.push(`Fläche ${idx}: ${cands.length} gleichwertige Flächen im STEP-Modell, nicht eindeutig`);
    else problems.push(`Fläche ${idx} (${sf.kind}): im STEP-Modell nicht gefunden (andere Lage oder anderes Bauteil?)`);
  }
  return { matches, problems };
}
