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

// positions quoted in warning texts, e.g. "12-34.56N 043-21.10E" or
// "12-34N 043-21E" — enough to put each warning on the map
const COORD = /(\d{1,2})-(\d{2}(?:\.\d+)?)\s*([NS])[\s,]+(\d{1,3})-(\d{2}(?:\.\d+)?)\s*([EW])/g;
const parsePoints = (text) => {
  const pts = [];
  for (const m of text.matchAll(COORD)) {
    const lat = (Number(m[1]) + Number(m[2]) / 60) * (m[3] === "S" ? -1 : 1);
    const lon = (Number(m[4]) + Number(m[5]) / 60) * (m[6] === "W" ? -1 : 1);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) pts.push([Math.round(lat * 1000) / 1000, Math.round(lon * 1000) / 1000]);
    if (pts.length >= 12) break;
  }
  return pts;
};

const kept = all
  .filter((w) => w.text && HOSTILE.test(w.text))
  .map((w) => ({
    ref: `NAVAREA ${w.navArea} ${w.msgNumber}/${w.msgYear}`,
    navArea: w.navArea,
    year: w.msgYear,
    issued: w.issueDate ?? null,
    text: w.text.replace(/\s+/g, " ").trim().slice(0, 900),
    points: parsePoints(w.text),
  }))
  .sort((a, b) => b.year - a.year || String(b.ref).localeCompare(String(a.ref)));

writeFileSync(
  new URL("../public/data/navarea.json", import.meta.url),
  JSON.stringify({ fetched: new Date().toISOString().slice(0, 10), total: all.length, warnings: kept }),
);
console.log(`navarea: ${kept.length} security-relevant of ${all.length} active warnings`);
