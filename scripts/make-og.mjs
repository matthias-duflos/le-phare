// Renders the social share card: the home hero (night globe) at OG size.
// Needs the dev server (or preview) at :4321.
// Run: node scripts/make-og.mjs
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:4321";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
await page.goto(`${base}/`, { waitUntil: "networkidle" });
// let the globe render a few frames and the headline settle
await page.waitForTimeout(4500);
// hide chrome that reads badly at card size
await page.addStyleTag({ content: "header{display:none!important}" });
await page.waitForTimeout(300);
await page.screenshot({ path: "public/og.png", clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close();
console.log("public/og.png written (2400×1260 @2x)");
