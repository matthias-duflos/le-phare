// Benchmark: how fast does the live-watch picture fill, per strait?
// Connects exactly like the site (one socket, all boxes) and logs unique
// vessels per strait over time. Two configs:
//   node scripts/bench-ais.mjs narrow   — PositionReport only (site today)
//   node scripts/bench-ais.mjs wide     — every message type with a position
import { STRAITS_BOXES } from "./bench-boxes.mjs";

const KEY = process.env.AISSTREAM_KEY || "fd6fd598e436ac812a074f87ee2e269890ea8471";
const MODE = process.argv[2] || "narrow";
const MINUTES = Number(process.argv[3] || 4);

const boxes = STRAITS_BOXES;
const perStrait = new Map(boxes.map((b) => [b.slug, new Set()]));
let msgs = 0;

const sub = {
  APIKey: KEY,
  BoundingBoxes: boxes.map((b) => b.bbox),
};
if (MODE === "narrow") sub.FilterMessageTypes = ["PositionReport"];

const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
const t0 = Date.now();
ws.onopen = () => {
  ws.send(JSON.stringify(sub));
  console.log(`[${MODE}] subscribed to ${boxes.length} boxes, running ${MINUTES} min`);
};
ws.onmessage = async (ev) => {
  try {
    const txt = typeof ev.data === "string" ? ev.data : await ev.data.text();
    const m = JSON.parse(txt);
    const meta = m.MetaData;
    if (!meta || meta.latitude == null) return;
    msgs++;
    for (const b of boxes) {
      const [[la1, lo1], [la2, lo2]] = b.bbox;
      if (meta.latitude >= la1 && meta.latitude <= la2 && meta.longitude >= lo1 && meta.longitude <= lo2) {
        perStrait.get(b.slug).add(meta.MMSI);
      }
    }
  } catch {}
};
ws.onclose = (e) => console.log("closed", e.code, e.reason);

const report = () => {
  const dt = Math.round((Date.now() - t0) / 1000);
  const counts = boxes
    .map((b) => `${b.slug}:${perStrait.get(b.slug).size}`)
    .join(" ");
  const total = [...perStrait.values()].reduce((a, s) => a + s.size, 0);
  console.log(`t=${dt}s msgs=${msgs} total=${total} | ${counts}`);
};
const iv = setInterval(report, 30000);
setTimeout(() => {
  report();
  clearInterval(iv);
  ws.close();
  process.exit(0);
}, MINUTES * 60000);
