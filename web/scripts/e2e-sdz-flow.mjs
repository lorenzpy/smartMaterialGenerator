// SPDX-License-Identifier: AGPL-3.0-only
// Multi-material fork: the three ways to bring a Fusion setup in, plus the
// regression case "STEP alone" (must not create any boundary conditions).
// Usage: (dev server on :5173)  node scripts/e2e-sdz-flow.mjs <file.sdz> <file.step> [outDir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const [sdz, step, out = "/tmp/sdz-flow"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium",
  args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, serviceWorkers: "block" });
const page = await ctx.newPage();
await page.goto("http://localhost:5173/", { waitUntil: "load" });
await page.locator("button.consent").click();
await page.waitForTimeout(10000);
const input = () => page.locator('input[type="file"][accept*=".sdz"]').first();
const toast = async () => ((await page.locator(".toast").first().innerText().catch(() => "")) || "").replace(/\s+/g, " ");
const waitToast = async (re, secs = 120) => {
  for (let i = 0; i < secs; i++) {
    const t = await toast();
    if (re.test(t)) return t;
    await page.waitForTimeout(1000);
  }
  return await toast();
};
const bcRows = async () => {
  await page.locator("button").filter({ hasText: /LOADS/i }).first().click().catch(() => {});
  await page.waitForTimeout(800);
  const t = await page.locator("body").innerText();
  const names = ["Fest1", "Kraft1", "Kraft2", "Moment1", "Moment2"].filter((n) => t.includes(n));
  return names;
};

console.log("== A: .sdz alone while the sample part is loaded (must NOT apply) ==");
await input().setInputFiles([sdz]);
console.log("notice:", (await waitToast(/Setup aus/, 30)).slice(0, 260));
console.log("BCs present:", await bcRows());

console.log("\n== B: now the STEP alone (pending setup applies automatically) ==");
await input().setInputFiles([step]);
console.log("notice:", (await waitToast(/übernommen/, 150)).slice(0, 300));
console.log("BCs present:", await bcRows());
// expand Kraft1 / Moment1 to read the vectors
for (const name of ["Kraft1", "Kraft2", "Moment1"]) {
  const row = page.locator("div", { hasText: new RegExp(`^${name}`) }).first();
  await row.locator("text=▸").first().click({ timeout: 2000 }).catch(() => {});
}
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/B-expanded.png` });
const body = await page.locator(".steppanel, aside, .panel").first().innerText().catch(() => "");
console.log(body.slice(0, 1800));

console.log("\n== C: STEP alone again, no setup pending (regression: normal load, no BCs) ==");
await input().setInputFiles([step]);
await page.waitForTimeout(25000);
console.log("notice:", (await toast()).slice(0, 200));
console.log("BCs present:", await bcRows());
await browser.close();
