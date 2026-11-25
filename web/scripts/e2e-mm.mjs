// SPDX-License-Identifier: AGPL-3.0-only
// Multi-material fork: drive the real app through the normal steps —
// Properties (pick materials) -> Optimize (run) — with service workers ENABLED,
// exactly like a user's browser.
// Usage: (dev server on :5173)  node scripts/e2e-mm.mjs [outDir] [cells] [iters]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "/tmp/mm-shots";
const cells = process.argv[3] ?? "2000";
const iters = process.argv[4] ?? "30";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium",
  args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(process.env.URL ?? "http://localhost:5173/", { waitUntil: "load" });
await page.locator("button.consent").click({ timeout: 30000 }); // per-session disclaimer, accepted by this local test
await page.waitForTimeout(15000); // startup sample + canned loads
const step = (label) => page.locator("button.station").filter({ hasText: new RegExp(label, "i") }).first().click();

await step("Properties");
await page.waitForTimeout(800);
// The part's own material (PLA) is the first one of the mix; add two more with the same selector.
const add = () => page.getByRole("button", { name: "+ Add another material" }).click();
await add();
await page.locator(".mmpick select").nth(0).selectOption("ASA");
await add();
await page.locator(".mmpick select").nth(1).selectOption({ label: "TPU 95A (Testwert)" });
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/1-properties.png` });

await step("Optimize");
await page.waitForTimeout(800);
const numAfter = async (label, value) => {
  const g = page.locator(".group", { has: page.locator(`.g-label span:text-is("${label}")`) }).first();
  await g.locator("input").first().fill(String(value));
};
await page.locator(".sec-head", { hasText: "Run settings" }).click().catch(() => {});
await numAfter("Grid cells", cells);
await numAfter("Iterations", iters);
if (process.env.MAXPLA) await page.locator(".mmrow input.mmpct").first().fill(process.env.MAXPLA);
await page.locator(".sec-head", { hasText: "Printing" }).click().catch(() => {});
await page.screenshot({ path: `${out}/2-optimize.png` });

const t0 = Date.now();
await page.getByRole("button", { name: /Optimize material distribution/ }).click();
for (let i = 0; i < 1500; i++) {
  if (await page.getByTestId("mm-result").count()) break;
  if (i % 30 === 0 && (await page.getByTestId("mm-progress").count())) console.log("progress:", await page.getByTestId("mm-progress").innerText());
  await page.waitForTimeout(1000);
}
console.log("run wall time s:", ((Date.now() - t0) / 1000).toFixed(1));
if (await page.getByTestId("mm-result").count()) console.log(await page.getByTestId("mm-result").innerText());
else console.log("NO RESULT; panel:", (await page.locator(".panel").first().innerText()).slice(0, 600));
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/3-result.png` });
// Mesh view: the voxel cells coloured by material.
await page.locator(".viewchips button, .chips button").filter({ hasText: /^Mesh$/ }).first().click().catch(async () => {
  await page.getByRole("button", { name: "Mesh", exact: true }).first().click();
});
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/4-mesh.png` });
if (process.env.SECTION) {
  await page.getByRole("button", { name: "Section", exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${out}/5-mesh-section.png` });
}
console.log(logs.filter((l) => /error|panic|unreachable|engine:/i.test(l)).slice(0, 8).join("\n"));
await browser.close();
