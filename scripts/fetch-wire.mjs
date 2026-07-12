// Snapshots the GDELT maritime wire to public/data/wire.json so the site
// always has alerts to show even when the client hits GDELT's rate limit.
// Tolerant: on failure it keeps the existing snapshot. Retries with backoff.
// Run: node scripts/fetch-wire.mjs

import { writeFileSync } from "node:fs";

const QUERY = encodeURIComponent(
  '("red sea" OR "bab el-mandeb" OR "strait of hormuz" OR "suez canal" OR "shadow fleet" OR "gps jamming" OR piracy) (shipping OR vessel OR tanker OR maritime) sourcelang:english',
);
const URL_ = `https://api.gdeltproject.org/api/v2/doc/doc?query=${QUERY}&mode=artlist&maxrecords=60&timespan=7d&format=json&sort=datedesc`;

let articles = null;
for (let attempt = 1; attempt <= 4; attempt++) {
  try {
    const res = await fetch(URL_);
    if (res.ok) {
      const d = await res.json();
      if (d.articles) {
        articles = d.articles;
        break;
      }
    }
    console.log(`attempt ${attempt}: HTTP ${res.status}, backing off`);
  } catch (e) {
    console.log(`attempt ${attempt}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 30000 * attempt));
}

if (!articles) {
  console.log("wire unavailable, keeping existing snapshot");
  process.exit(0);
}

const seen = new Set();
const out = [];
for (const a of articles) {
  const k = a.title.toLowerCase().slice(0, 55);
  if (seen.has(k)) continue;
  seen.add(k);
  out.push({ url: a.url, title: a.title.trim(), domain: a.domain, seendate: a.seendate });
  if (out.length >= 25) break;
}

writeFileSync(
  new URL("../public/data/wire.json", import.meta.url),
  JSON.stringify({ fetched: new Date().toISOString(), articles: out }),
);
console.log(`wire.json: ${out.length} articles`);
