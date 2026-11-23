// SPDX-License-Identifier: AGPL-3.0-only
// Multi-material fork: drive the real app — load a Fusion .sdz TOGETHER with its
// STEP file through the normal file picker and check that material, supports
// and loads arrive without any manual step.
// Usage: (dev server on :5173)  node scripts/e2e-sdz.mjs <file.sdz> <file.step> [outDir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const [sdz, step, out = "/tmp/sdz-shots"] = process.argv.slice(2);
if (!sdz || !step) throw new Error("usage: node scripts/e2e-sdz.mjs <file.sdz> <file.step> [outDir]");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium",
  args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, serviceWorkers: "block" });
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(process.env.URL ?? "http://localhost:5173/", { waitUntil: "load" });
await page.locator("button.consent").click(); // per-session disclaimer, accepted by this local test
await page.waitForTimeout(10000); // startup sample model
// The same <input type=file> the "Replace model…" button opens.
await page.locator('input[type="file"][accept*=".sdz"]').first().setInputFiles([sdz, step]);
// wait for the notice produced by the setup import
let notice = "";
for (let i = 0; i < 120; i++) {
  notice = (await page.locator(".toast.notice, .toast").first().innerText().catch(() => "")) || "";
  if (/Setup aus/.test(notice)) break;
  await page.waitForTimeout(1000);
}
console.log("NOTICE:", notice.replace(/\s+/g, " "));
await page.screenshot({ path: `${out}/1-after-import.png` });
// Loads step
await page.locator(".steprail button, button").filter({ hasText: /LOADS/i }).first().click().catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/2-loads.png` });
const panel = await page.locator(".steppanel, aside, .panel").first().innerText().catch(() => "");
console.log("PANEL TEXT:\n" + panel.slice(0, 1500));
console.log(logs.filter((l) => /error|panic|Fusion|SAT/i.test(l)).slice(0, 12).join("\n"));
await browser.close();
