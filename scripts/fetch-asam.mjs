// Ingests the NGA Anti-Shipping Activity Messages archive (public domain)
// from the official ArcGIS feature service into our incident schema.
// The ASAM programme was defunded on 30 June 2024, so this is a closed
// historical archive; 2026 entries are curated separately.
//
// Run: node scripts/fetch-asam.mjs

import { writeFileSync } from "node:fs";

const BASE =
  "https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/ASAM_events_V1/FeatureServer/0/query";
const SINCE = "2022-01-01";

const classify = (text) => {
  const t = text.toLowerCase();
  if (/hijack/.test(t)) return "hijack";
  if (/\bmine\b|mines\b/.test(t)) return "mine";
  if (/jam|gps|ais interference|spoof/.test(t)) return "gps-jamming";
  if (/seiz|detain|confiscat|arrest/.test(t)) return "seizure";
  if (/missile|drone|uav|usv|explosion|projectile|rocket|struck by|impact/.test(t)) return "drone-strike";
  if (/board|robber|theft|stole|stolen|intruder|attempt/.test(t)) return "boarding";
  if (/fired|gunmen|shots|attack/.test(t)) return "boarding";
  return "boarding";
};

const ZONES = [
  { name: "Southern Red Sea", box: [11.5, 40, 17, 44.5] },
  { name: "Bab el-Mandeb", box: [11.8, 42.8, 13.3, 44.2] },
  { name: "Gulf of Aden", box: [10.5, 44.2, 15.5, 52] },
  { name: "Red Sea (north & central)", box: [17, 32, 30.5, 42] },
  { name: "Arabian Sea", box: [2, 52, 20, 70] },
  { name: "Strait of Hormuz", box: [24.5, 55.5, 27.5, 58.5] },
  { name: "Persian Gulf", box: [23.5, 47, 30.5, 55.5] },
  { name: "Gulf of Oman", box: [22, 56.5, 26.5, 62] },
  { name: "Gulf of Guinea", box: [-5, -8, 9, 12] },
  { name: "Black Sea", box: [40.5, 27, 47.5, 42] },
  { name: "Singapore Strait", box: [0.8, 103, 1.6, 105] },
  { name: "Malacca Strait", box: [1.2, 98, 6.5, 103.5] },
  { name: "Southeast Asia", box: [-8, 95, 22, 130] },
  { name: "Indian Ocean", box: [-25, 40, 10, 95] },
  { name: "Caribbean & Americas", box: [-5, -100, 30, -50] },
  { name: "South America (Pacific)", box: [-40, -85, 5, -70] },
];
const zoneOf = (lat, lon) => {
  for (const z of ZONES) {
    const [a, b, c, d] = z.box;
    if (lat >= a && lat <= c && lon >= b && lon <= d) return z.name;
  }
  return "Other waters";
};

const all = [];
let offset = 0;
for (;;) {
  const url = `${BASE}?where=dateofocc >= DATE '${SINCE}'&outFields=reference,dateofocc,hostility_d,victim_d,description,navarea&orderByFields=dateofocc DESC&resultOffset=${offset}&resultRecordCount=1000&f=json`;
  const res = await fetch(encodeURI(url));
  if (!res.ok) throw new Error(`ASAM query failed: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  all.push(...data.features);
  if (!data.exceededTransferLimit) break;
  offset += data.features.length;
}

const out = all
  .filter((f) => f.geometry && f.attributes.description)
  .map((f) => {
    const a = f.attributes;
    const lat = Math.round(f.geometry.y * 1000) / 1000;
    const lon = Math.round(f.geometry.x * 1000) / 1000;
    return {
      id: `ASAM ${a.reference}`,
      date: new Date(a.dateofocc).toISOString().slice(0, 10),
      type: classify(`${a.hostility_d ?? ""} ${a.description}`),
      zone: zoneOf(lat, lon),
      lat,
      lon,
      vessel: a.victim_d || null,
      hostility: a.hostility_d || null,
      summary: a.description,
      source: { name: `NGA ASAM ${a.reference}`, url: "https://msi.nga.mil/Piracy" },
    };
  });

writeFileSync(
  new URL("../public/data/incidents-asam.json", import.meta.url),
  JSON.stringify(out),
);
console.log(`incidents-asam.json: ${out.length} events since ${SINCE} (latest ${out[0]?.date})`);
