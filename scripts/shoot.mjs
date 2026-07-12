// Screenshot the styleguide for self-review.
// Usage: node scripts/shoot.mjs [outDir] [--light]
import { chromium } from "playwright";

const out = process.argv[2] ?? "shots";
const light = process.argv.includes("--light");
const base = "http://localhost:4321";

const browser = await chromium.launch();

for (const [name, viewport] of [
  ["desktop", { width: 1440, height: 900 }],
  ["mobile", { width: 390, height: 844 }],
]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  if (light) {
    await page.addInitScript(() => localStorage.setItem("phare-theme", "light"));
  }
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/styleguide`, { waitUntil: "networkidle" });
  // step through the page so client:visible islands hydrate and counters run
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < height; y += viewport.height * 0.8) {
    await page.mouse.wheel(0, viewport.height * 0.8);
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(2200);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  const suffix = light ? "-light" : "";
  await page.screenshot({ path: `${out}/styleguide-${name}${suffix}.png`, fullPage: true });
  if (errors.length) console.log(`[${name}${suffix}] console errors:\n` + errors.join("\n"));
  await page.close();
}

await browser.close();
console.log("shots written to", out);
