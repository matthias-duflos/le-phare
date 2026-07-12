// Ingests ACTIVE NAVAREA broadcast warnings from NGA MSI (public domain,
// current) and keeps those relevant to maritime security. Unlike ASAM,
// this feed is alive. Run: node scripts/fetch-navarea.mjs

import { writeFileSync } from "node:fs";

const URL_ = "https://msi.nga.mil/api/publications/broadcast-warn?status=active&output=json";
const HOSTILE =
  /attack|missile|drone|uav|usv|hostil|piracy|pirate|armed|seiz|hijack|mine danger|minefield|explos|jamming|gps interference|security threat|conflict|exclusion zone|avoid the area|warlike|firing|rocket|launching|gunnery|live fire|unexploded|ordnance|suspicious approach|military exercise|hazardous operations/i;

const res = await fetch(URL_);
if (!res.ok) throw new Error(`navwarn fetch failed ${res.status}`);
const data = await res.json();
const all = data["broadcast-warn"] ?? [];

const kept = all
  .filter((w) => w.text && HOSTILE.test(w.text))
  .map((w) => ({
    ref: `NAVAREA ${w.navArea} ${w.msgNumber}/${w.msgYear}`,
    navArea: w.navArea,
    year: w.msgYear,
    issued: w.issueDate ?? null,
    text: w.text.replace(/\s+/g, " ").trim().slice(0, 900),
  }))
  .sort((a, b) => b.year - a.year || String(b.ref).localeCompare(String(a.ref)));

writeFileSync(
  new URL("../public/data/navarea.json", import.meta.url),
  JSON.stringify({ fetched: new Date().toISOString().slice(0, 10), total: all.length, warnings: kept }),
);
console.log(`navarea: ${kept.length} security-relevant of ${all.length} active warnings`);
