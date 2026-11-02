// SPDX-License-Identifier: AGPL-3.0-only
// Multi-material fork: drive the real app in Chromium — sample part with its
// canned loads, open the multi-material panel, run, screenshot.
// Usage: (dev server on :5173)  node scripts/e2e-mm.mjs [outDir] [cells] [iters]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "/tmp/mm-shots";
const cells = process.argv[3] ?? "3000";
const iters = process.argv[4] ?? "60";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium",
  args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});
// No service worker: the cross-origin-isolation worker would switch the engine
// to the threaded WASM build, which this checkout does not ship.
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, serviceWorkers: "block" });
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto("http://localhost:5173/", { waitUntil: "load" });
// The app shows a per-session disclaimer; this local test accepts it.
await page.locator("button.consent").click();
// Wait for the sample model — give the importer time.
await page.waitForTimeout(12000);
await page.screenshot({ path: `${out}/1-loaded.png` });

await page.getByTestId("mm-toggle").click();
await page.getByTestId("mm-panel").waitFor();
// Set analysis cells and iterations through the labelled inputs.
const setField = async (label, value) => {
  const inp = page.locator(`label.mm-field:has(span:text-is("${label}")) input`).first();
  await inp.fill(String(value));
};
await setField("cells", cells);
await setField("iterations", iters);
// Optional overrides: W_C / W_R objective weights, PLA_LIM (PLA stress limit,
// MPa) so a low limit makes PLA fail at the sample load and a trade-off appears.
if (process.env.W_C) await setField("deformation (stiffness)", process.env.W_C);
if (process.env.W_R) await setField("failure risk (cracking)", process.env.W_R);
if (process.env.PLA_LIM) {
  await page.locator(".mm-mat").first().locator('label.mm-field:has(span:text-is("σ lim MPa")) input').fill(process.env.PLA_LIM);
}
await page.screenshot({ path: `${out}/2-panel.png` });

const t0 = Date.now();
await page.getByTestId("mm-run").click();
let lastProgress = "";
for (let i = 0; i < 900; i++) {
  if (await page.getByTestId("mm-result").count()) break;
  const err = await page.locator(".mm-error").count();
  if (err) break;
  if (i % 10 === 0 && (await page.getByTestId("mm-progress").count())) {
    lastProgress = await page.getByTestId("mm-progress").innerText();
    if (i % 50 === 0) console.log("progress:", lastProgress);
  }
  await page.waitForTimeout(1000);
}
console.log("run wall time s:", ((Date.now() - t0) / 1000).toFixed(1));
if (await page.locator(".mm-error").count()) console.log("ERROR:", await page.locator(".mm-error").innerText());
if (await page.getByTestId("mm-result").count()) console.log(await page.getByTestId("mm-result").innerText());
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/3-result.png` });
// Close the panel for an unobstructed look at the multi-material surfaces,
// then once more with the section plane on to look inside.
await page.getByTestId("mm-toggle").click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/4-viewport.png` });
const section = page.getByRole("button", { name: "Section" });
if (await section.count()) {
  await section.first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/5-section.png` });
}
console.log(logs.filter((l) => /error|panic|wasm|unreachable/i.test(l)).slice(0, 10).join("\n"));
await browser.close();
