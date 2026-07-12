// Ingests IMF PortWatch daily chokepoint transit calls (open data, updated
// weekly with a ~5 day lag) for the observatory's twelve chokepoints.
// Outputs: public/data/portwatch.json  (daily series, fetched at runtime by /data)
//          src/data/transits-weekly.json (weekly aggregates, bundled: /straits, home)
// Run: node scripts/fetch-portwatch.mjs

import { writeFileSync } from "node:fs";

const BASE =
  "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query";
const SINCE = "2024-01-01";

const NAMES = {
  "Suez Canal": "suez",
  "Panama Canal": "panama",
  "Bab el-Mandeb Strait": "bab-el-mandeb",
  "Cape of Good Hope": "good-hope",
  "Gibraltar Strait": "gibraltar",
  "Dover Strait": "dover",
  "Bosporus Strait": "bosphorus",
  "Oresund Strait": "danish-straits",
  "Malacca Strait": "malacca",
  "Strait of Hormuz": "hormuz",
  "Taiwan Strait": "taiwan-strait",
  "Kerch Strait": "kerch",
};

const inList = Object.keys(NAMES).map((n) => `'${n}'`).join(",");
const rows = [];
let offset = 0;
for (;;) {
  const url = `${BASE}?where=portname IN (${inList}) AND date >= DATE '${SINCE}'&outFields=date,portname,n_total,n_tanker,n_container,n_cargo,n_dry_bulk,capacity&orderByFields=date&resultOffset=${offset}&resultRecordCount=2000&f=json`;
  const res = await fetch(encodeURI(url));
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  rows.push(...data.features.map((f) => f.attributes));
  if (!data.exceededTransferLimit) break;
  offset += data.features.length;
}

const daily = {};
for (const [name, slug] of Object.entries(NAMES)) daily[slug] = { name, series: [] };
for (const r of rows) {
  daily[NAMES[r.portname]].series.push([
    r.date,
    r.n_total,
    r.n_tanker,
    r.n_container,
    r.n_cargo,
    r.n_dry_bulk,
    Math.round(r.capacity),
  ]);
}
const latestDate = rows.reduce((a, r) => (r.date > a ? r.date : a), "");

writeFileSync(
  new URL("../public/data/portwatch.json", import.meta.url),
  JSON.stringify({
    updated: latestDate,
    source: "IMF PortWatch (portwatch.imf.org), open data",
    columns: ["date", "total", "tanker", "container", "cargo", "dry_bulk", "capacity_dwt"],
    chokepoints: daily,
  }),
);

// ---- weekly aggregates (ISO week, complete weeks only) ----
const isoWeek = (d) => {
  const dt = new Date(d + "T00:00:00Z");
  const day = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const fday = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fday + 3);
  const week = 1 + Math.round((dt - firstThu) / 604800000);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
};

const weekly = {};
for (const [slug, { name, series }] of Object.entries(daily)) {
  const byWeek = new Map();
  for (const [date, total] of series) {
    const w = isoWeek(date);
    const e = byWeek.get(w) ?? { t: 0, n: 0 };
    e.t += total;
    e.n++;
    byWeek.set(w, e);
  }
  const full = [...byWeek.entries()].filter(([, v]) => v.n === 7).map(([w, v]) => ({ w, t: v.t }));
  full.sort((a, b) => (a.w < b.w ? -1 : 1));
  const recent = full.slice(-27);
  const last = recent.at(-1);
  const prev = recent.at(-2);
  weekly[slug] = { name, weekly: recent, last: last?.t ?? null, delta: last && prev ? last.t - prev.t : null, week: last?.w };
}

const rerouting = weekly["good-hope"].weekly.map((e, i) => {
  const suez = weekly["suez"].weekly[i];
  return { w: e.w, idx: suez && suez.t ? Math.round((e.t / suez.t) * 100) / 100 : null };
});

writeFileSync(
  new URL("../src/data/transits-weekly.json", import.meta.url),
  JSON.stringify({ updated: latestDate, chokepoints: weekly, rerouting }),
);
console.log(`portwatch: ${rows.length} daily rows to ${latestDate}; weekly last = ${weekly["bab-el-mandeb"].week}, bab=${weekly["bab-el-mandeb"].last}, rerouting=${rerouting.at(-1)?.idx}`);
