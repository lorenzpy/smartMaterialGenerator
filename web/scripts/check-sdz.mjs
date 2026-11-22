// SPDX-License-Identifier: AGPL-3.0-only
// Multi-material fork: check the Fusion .sdz reader and the face matching
// against a real export, without a browser.
// Usage: node --experimental-strip-types scripts/check-sdz.mjs <file.sdz> <file.step>
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/engine");
const { parseSdz, matchFaces } = await import(`${base}/sdz/sdz.ts`);
const { convertStepBytes } = await import(`${base}/stepConvert.ts`);
const ab = (f) => { const b = readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const setup = await parseSdz(ab(process.argv[2]));
const step = await convertStepBytes(ab(process.argv[3]), undefined, () => {});
const { matches, problems } = matchFaces(setup.faces, setup.faceCount, step.faces);
console.log(`study "${setup.studyName}", material ${setup.material ? `${setup.material.name} E=${setup.material.e0.toFixed(0)} MPa nu=${setup.material.nu}` : "none"}`);
for (const l of setup.loads) console.log(`  ${l.kind} ${l.name}: ${l.magnitude} dir ${l.dir.map((x) => +x.toFixed(3))} faces ${l.faces}`);
for (const c of setup.constraints) console.log(`  support ${c.name} (${c.type}) faces ${c.faces}`);
const wanted = new Set([...setup.loads.flatMap((l) => l.faces), ...setup.constraints.flatMap((c) => c.faces)]);
console.log(`faces matched: ${matches.size}/${wanted.size}`, problems.length ? `PROBLEMS: ${problems.join("; ")}` : "");
process.exit(matches.size === wanted.size && problems.length === 0 ? 0 : 1);
