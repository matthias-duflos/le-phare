// AIS Integrity Watch — real pipeline.
// Listens to aisstream.io over the six monitored zones in one bounded
// session, runs the five integrity heuristics in memory, and appends
// ONE aggregated session to src/data/anomalies.json.
//
// The guardrail IS the module: nothing vessel-identifying is ever
// written. MMSIs exist only in process memory for the duration of the
// session; the output is counts per zone per heuristic.
//
// Run:  AISSTREAM_KEY=... node scripts/fetch-anomalies.mjs
// or locally:  node --env-file=.env scripts/fetch-anomalies.mjs
// Optional: ANOMALY_MINUTES (default 12).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { feature } from "topojson-client";
import { geoContains, geoDistance } from "d3-geo";

const KEY = process.env.AISSTREAM_KEY ?? process.env.PUBLIC_AISSTREAM_KEY;
if (!KEY) {
  console.log("anomalies: no AISSTREAM_KEY in env, skipping (nothing written)");
  process.exit(0);
}
const MINUTES = Number(process.env.ANOMALY_MINUTES ?? 12);

// [[lat,lon] SW, [lat,lon] NE] — aisstream convention
const ZONES = [
  { id: "hormuz", name: "Strait of Hormuz", bbox: [[25.4, 55.4], [27.3, 57.6]] },
  { id: "black-sea", name: "Black Sea", bbox: [[41.0, 27.5], [47.0, 42.0]] },
  { id: "gulf-of-finland", name: "Gulf of Finland", bbox: [[59.2, 22.5], [60.8, 30.3]] },
  { id: "east-med", name: "Eastern Mediterranean", bbox: [[31.0, 25.0], [36.5, 36.3]] },
  { id: "southern-red-sea", name: "Southern Red Sea", bbox: [[11.5, 41.0], [16.5, 44.5]] },
  { id: "gulf-of-guinea", name: "Gulf of Guinea", bbox: [[-1.0, -6.0], [6.5, 9.0]] },
];
const HEURISTICS = ["jamming-cluster", "impossible-jump", "speed-anomaly", "dark-gap", "position-on-land"];

// thresholds
const JUMP_KN = 100; // implied speed no hull reaches
const JUMP_MIN_KM = 2; // ignore GPS jitter
const SPEED_KN = 45; // above any merchant/HSC envelope
const SPEED_SUSTAINED = 3; // consecutive messages
const GAP_MS = 8 * 60000; // dark gap threshold, bounded within the session
const CLUSTER_VESSELS = 5; // distinct displaced vessels…
const CLUSTER_WINDOW_MS = 5 * 60000; // …within this window = one jamming cluster

// Natural Earth 50m land for the on-land test; a point must be solidly
// inland (itself + 4 neighbours ~3 km away) to flag, so port calls and
// coastline rasterisation don't count.
const topo = await (await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/land-50m.json")).json();
const land = feature(topo, topo.objects.land);
const D = 0.03;
const onLand = (lon, lat) =>
  [[lon, lat], [lon + D, lat], [lon - D, lat], [lon, lat + D], [lon, lat - D]].every((p) => geoContains(land, p));

const inZone = (lat, lon) =>
  ZONES.find((z) => lat >= z.bbox[0][0] && lat <= z.bbox[1][0] && lon >= z.bbox[0][1] && lon <= z.bbox[1][1]);

const kmBetween = (a, b) => geoDistance([a.lon, a.lat], [b.lon, b.lat]) * 6371;

// per-zone aggregates + in-memory per-vessel state (never persisted)
const agg = Object.fromEntries(
  ZONES.map((z) => [z.id, { messages: 0, vessels: new Set(), counts: Object.fromEntries(HEURISTICS.map((h) => [h, 0])) }]),
);
const track = new Map(); // mmsi -> { last, fastRun, flagged:Set, gaps:Set }
const displaced = Object.fromEntries(ZONES.map((z) => [z.id, []])); // timestamps of displaced-position vessels
const clusterUntil = Object.fromEntries(ZONES.map((z) => [z.id, 0]));

let received = 0;
const t0 = Date.now();
const deadline = t0 + MINUTES * 60000;

const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
ws.onopen = () => {
  ws.send(JSON.stringify({ APIKey: KEY, BoundingBoxes: ZONES.map((z) => z.bbox), FilterMessageTypes: ["PositionReport"] }));
  console.log(`anomalies: listening ${MINUTES} min over ${ZONES.length} zones…`);
};
ws.onmessage = async (ev) => {
  try {
    const txt = typeof ev.data === "string" ? ev.data : await ev.data.text();
    const m = JSON.parse(txt);
    const meta = m.MetaData;
    const pr = m.Message?.PositionReport;
    if (!meta || !pr) return;
    const lat = meta.latitude, lon = meta.longitude;
    const zone = inZone(lat, lon);
    if (!zone) return;
    const now = Date.now();
    const a = agg[zone.id];
    a.messages += 1;
    a.vessels.add(meta.MMSI);
    received += 1;

    let v = track.get(meta.MMSI);
    if (!v) {
      v = { last: null, fastRun: 0, flagged: new Set(), gaps: new Set() };
      track.set(meta.MMSI, v);
    }
    const fix = { lat, lon, t: now, sog: pr.Sog ?? 0 };
    let displacedNow = false;

    // position-on-land — once per vessel per session
    if (!v.flagged.has("position-on-land") && onLand(lon, lat)) {
      a.counts["position-on-land"] += 1;
      v.flagged.add("position-on-land");
      displacedNow = true;
    }

    // speed-anomaly — SOG above envelope sustained across consecutive messages
    v.fastRun = fix.sog >= SPEED_KN ? v.fastRun + 1 : 0;
    if (v.fastRun >= SPEED_SUSTAINED && !v.flagged.has("speed-anomaly")) {
      a.counts["speed-anomaly"] += 1;
      v.flagged.add("speed-anomaly");
    }

    if (v.last) {
      const dtH = (fix.t - v.last.t) / 3600000;
      const km = kmBetween(v.last, fix);
      // impossible-jump — implied speed no hull reaches
      if (dtH > 0 && km > JUMP_MIN_KM && km / 1.852 / dtH > JUMP_KN && !v.flagged.has("impossible-jump")) {
        a.counts["impossible-jump"] += 1;
        v.flagged.add("impossible-jump");
        displacedNow = true;
      }
      // dark-gap — bounded silence from an underway vessel, once per gap
      const gapKey = Math.floor(v.last.t / GAP_MS);
      if (fix.t - v.last.t >= GAP_MS && v.last.sog > 1 && !v.gaps.has(gapKey)) {
        a.counts["dark-gap"] += 1;
        v.gaps.add(gapKey);
      }
    }
    v.last = fix;

    // jamming-cluster — several distinct displaced vessels in one zone within the window
    if (displacedNow) {
      const arr = displaced[zone.id];
      arr.push(now);
      while (arr.length && now - arr[0] > CLUSTER_WINDOW_MS) arr.shift();
      if (arr.length >= CLUSTER_VESSELS && now > clusterUntil[zone.id]) {
        a.counts["jamming-cluster"] += 1;
        clusterUntil[zone.id] = now + CLUSTER_WINDOW_MS; // one cluster per window
      }
    }
  } catch {}
};
ws.onerror = (e) => {
  console.error("anomalies: websocket error", e?.message ?? "");
};

await new Promise((resolve) => {
  const tick = setInterval(() => {
    if (Date.now() >= deadline || ws.readyState === WebSocket.CLOSED) {
      clearInterval(tick);
      try { ws.close(); } catch {}
      resolve();
    }
  }, 1000);
});

if (received === 0) {
  console.error("anomalies: no messages received, not writing a session");
  process.exit(1);
}

// ISO week of today
const d = new Date();
const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
const week = `${day.getUTCFullYear()}-W${String(Math.ceil((((day - Date.UTC(day.getUTCFullYear(), 0, 1)) / 86400000) + 1) / 7)).padStart(2, "0")}`;

const dest = new URL("../src/data/anomalies.json", import.meta.url);
const file = existsSync(dest) ? JSON.parse(readFileSync(dest)) : { sessions: [] };
file.updated = new Date().toISOString();
file.sessions = file.sessions.filter((s) => s.date !== d.toISOString().slice(0, 10)); // idempotent per day
file.sessions.push({
  week,
  date: d.toISOString().slice(0, 10),
  minutes: MINUTES,
  zones: Object.fromEntries(
    ZONES.map((z) => {
      const a = agg[z.id];
      return [z.id, { name: z.name, messages: a.messages, vessels: a.vessels.size, counts: a.counts }];
    }),
  ),
});
file.sessions.sort((a, b) => a.date.localeCompare(b.date));
writeFileSync(dest, JSON.stringify(file, null, 1));

const totals = ZONES.map((z) => `${z.id}=${Object.values(agg[z.id].counts).reduce((x, y) => x + y, 0)}`).join(" ");
console.log(`anomalies: session ${week} written — ${received} msgs, ${track.size} vessels · ${totals}`);
