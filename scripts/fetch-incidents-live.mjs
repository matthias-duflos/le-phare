// Automated incident ingestion — no hand curation. Two official, open,
// geocoded feeds, normalized into the site's incident schema:
//   · ReCAAP ISC open map API — piracy & armed robbery, Asia (official)
//   · IMB Piracy Reporting Centre live map — worldwide sitreps
// Events since July 2024 (where the NGA ASAM archive stops). Duplicates are
// resolved ReCAAP > IMB > curated (same day ±1, within ~30 nm).
// Run: node scripts/fetch-incidents-live.mjs

import { readFileSync, writeFileSync } from "node:fs";

const SINCE = "2024-07-01";
const OUT = new URL("../public/data/incidents-live.json", import.meta.url);
const CURATED = JSON.parse(
  readFileSync(new URL("../src/data/incidents.json", import.meta.url), "utf8"),
);

// crude but effective typing from narrative text
const classify = (t) => {
  const s = (t || "").toLowerCase();
  if (/hijack/.test(s)) return "hijack";
  if (/missile|drone|uav|usv|projectile|rocket|rpg/.test(s)) return "drone-strike";
  if (/\bmine\b|minefield/.test(s)) return "mine";
  if (/seiz|detain|confiscat/.test(s)) return "seizure";
  if (/jamming|gps interference|spoofing/.test(s)) return "gps-jamming";
  return "boarding";
};

const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
const cap = (s, n = 420) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

/* ---------------- ReCAAP ---------------- */
async function fetchRecaap() {
  const url =
    "https://portal.recaap.org/recaap-api-be/api/v1/openMap/fetchInteractiveIncidents" +
    `?incidentStart=${SINCE}&incidentEnd=2099-01-01&page=0&size=1000&sortBy=timeOfIncident&sortDirection=DESC`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`recaap ${res.status}`);
  const rows = await res.json();
  return rows
    .filter((r) => r.positionLatitude != null && r.positionLongitude != null && r.timeOfIncident)
    .map((r) => {
      const narrative = clean(
        [r.detailsAttackMethod, r.detailsStolenCargo && `Stolen: ${r.detailsStolenCargo}.`, r.detailsDamages && `Damage: ${r.detailsDamages}.`]
          .filter(Boolean)
          .join(" "),
      ) || clean(r.incidentCaseDescription);
      return {
        id: `RC-${r.incidentNo || r.id}`,
        date: r.timeOfIncident.slice(0, 10),
        type: classify(narrative),
        zone: clean(r.positionSeaName) || "Asia",
        lat: Math.round(r.positionLatitude * 1000) / 1000,
        lon: Math.round(r.positionLongitude * 1000) / 1000,
        vessel: r.shipName ? clean(`${r.shipType ? r.shipType.toLowerCase() + " " : ""}${r.shipName}${r.shipFlag ? ` (${r.shipFlag} flag)` : ""}`) : null,
        summary: cap(`${r.incidentType === "Attempted" ? "Attempted boarding. " : ""}${narrative}`),
        source: { name: "ReCAAP ISC", url: "https://portal.recaap.org/OpenMap" },
        origin: "recaap",
      };
    });
}

/* ---------------- IMB PRC ---------------- */
async function fetchImb() {
  const res = await fetch("https://icc-ccs.org/wp-json/wpgmza/v1/markers", {
    headers: { "User-Agent": "LePhare-observatory (open-source research)" },
  });
  if (!res.ok) throw new Error(`imb ${res.status}`);
  const rows = await res.json();
  const out = [];
  for (const m of rows) {
    const cf = Object.fromEntries((m.custom_field_data || []).map((c) => [c.name, c.value]));
    const sitrep = clean(cf["Sitrep:"] || m.description || "");
    const dm = sitrep.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (!dm) continue;
    const date = `${dm[3]}-${dm[2]}-${dm[1]}`;
    if (date < SINCE) continue;
    const lat = parseFloat(m.lat);
    const lon = parseFloat(m.lng);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    // "Posn: 03:55.1N – 098:47.3E, Belawan Anchorage, Indonesia. ..." → place
    const pm = sitrep.match(/Posn:[^,]*,\s*([^.]+)\./);
    const place = pm ? clean(pm[1]) : "";
    const body = clean(sitrep.replace(/^[^.]*\.\s*/, "")); // drop the Posn header sentence
    out.push({
      id: `IMB-${(cf["Incident Number"] || m.title || m.id).toString().trim()}`,
      date,
      type: classify(sitrep),
      zone: place.includes(",") ? clean(place.split(",").pop()) : place || "Worldwide",
      lat: Math.round(lat * 1000) / 1000,
      lon: Math.round(lon * 1000) / 1000,
      vessel: null,
      summary: cap(`${place ? place + ". " : ""}${body}`),
      source: { name: "IMB Piracy Reporting Centre", url: "https://icc-ccs.org/index.php/piracy-reporting-centre/live-piracy-map" },
      origin: "imb",
    });
  }
  return out;
}

/* ---------------- dedupe ---------------- */
const near = (a, b) =>
  Math.abs(a.lat - b.lat) < 0.35 &&
  Math.abs(a.lon - b.lon) < 0.35 &&
  Math.abs(new Date(a.date) - new Date(b.date)) <= 2 * 86400000;

const [recaap, imb] = await Promise.all([
  fetchRecaap().catch((e) => (console.error("recaap failed:", e.message), [])),
  fetchImb().catch((e) => (console.error("imb failed:", e.message), [])),
]);

const merged = [...recaap];
let dupImb = 0;
for (const e of imb) {
  if (merged.some((r) => near(r, e))) dupImb++;
  else merged.push(e);
}
// curated editorial entries (the brief) take precedence over auto copies
let dupCur = 0;
const live = merged.filter((e) => {
  const dup = CURATED.some((c) => near(c, e));
  if (dup) dupCur++;
  return !dup;
});
live.sort((a, b) => b.date.localeCompare(a.date));

writeFileSync(
  OUT,
  JSON.stringify({ fetched: new Date().toISOString().slice(0, 10), since: SINCE, events: live }),
);
console.log(
  `incidents-live: ${live.length} events (recaap ${recaap.length}, imb ${imb.length}, ` +
    `${dupImb} imb dupes vs recaap, ${dupCur} auto dupes vs curated) since ${SINCE}`,
);
