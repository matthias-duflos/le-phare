// Ghost-picture seed for the live watch: listen ~2 min over every strait
// box and write the heard positions to public/data/ais-seed.json. The site
// paints these instantly as dimmed "earlier today" dots while the live
// stream builds on top — the map is never empty on arrival.
// Run: node scripts/fetch-ais-seed.mjs   (AISSTREAM_KEY env optional)
import { writeFileSync } from "node:fs";
import { STRAITS_BOXES } from "./bench-boxes.mjs";

const KEY = process.env.AISSTREAM_KEY || "fd6fd598e436ac812a074f87ee2e269890ea8471";
const LISTEN_S = Number(process.argv[2] || 120);
const OUT = new URL("../public/data/ais-seed.json", import.meta.url);

const vessels = new Map(); // mmsi -> [lon, lat, moving]
const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");

ws.onopen = () => {
  ws.send(JSON.stringify({ APIKey: KEY, BoundingBoxes: STRAITS_BOXES.map((b) => b.bbox) }));
  console.log(`ais-seed: listening ${LISTEN_S}s over ${STRAITS_BOXES.length} boxes`);
};
ws.onmessage = async (ev) => {
  try {
    const m = JSON.parse(typeof ev.data === "string" ? ev.data : await ev.data.text());
    const meta = m.MetaData;
    if (!meta || meta.latitude == null) return;
    const sog =
      m.Message?.PositionReport?.Sog ??
      m.Message?.StandardClassBPositionReport?.Sog ??
      (vessels.get(meta.MMSI)?.[2] ? 1 : 0);
    vessels.set(meta.MMSI, [
      Math.round(meta.longitude * 1000) / 1000,
      Math.round(meta.latitude * 1000) / 1000,
      sog > 0.5 ? 1 : 0,
    ]);
  } catch {}
};
ws.onclose = (e) => {
  if (vessels.size === 0) {
    console.error(`ais-seed: connection closed early (${e.code}) with nothing heard — keeping previous seed`);
    process.exit(0);
  }
};

setTimeout(() => {
  ws.close();
  if (vessels.size < 30) {
    // a thin session (key busy, receivers quiet) should not wipe a good seed
    console.log(`ais-seed: only ${vessels.size} vessels heard — keeping previous seed`);
    process.exit(0);
  }
  writeFileSync(OUT, JSON.stringify({ fetched: new Date().toISOString(), vessels: [...vessels.values()] }));
  console.log(`ais-seed: ${vessels.size} vessels written`);
  process.exit(0);
}, LISTEN_S * 1000);
