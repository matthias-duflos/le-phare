// Generates the dotted-world grid for the home hero.
// Samples a regular lon/lat grid against Natural Earth 110m land polygons
// (world-atlas TopoJSON) and writes normalized points to src/data/world-dots.json.
//
// Run once: node scripts/make-world-dots.mjs

import { writeFileSync, mkdirSync } from "node:fs";
import { feature } from "topojson-client";
import { geoContains } from "d3-geo";

const res = await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json");
if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
const topo = await res.json();
const land = feature(topo, topo.objects.land);

const STEP = 1.5;
const LAT_MAX = 74;
const LAT_MIN = -58;

const pts = [];
for (let lat = LAT_MAX; lat >= LAT_MIN; lat -= STEP) {
  for (let lon = -180; lon <= 180; lon += STEP) {
    if (geoContains(land, [lon, lat])) {
      // store as rounded lon/lat pairs; projection happens client-side
      pts.push(Math.round(lon * 10) / 10, Math.round(lat * 10) / 10);
    }
  }
}

mkdirSync(new URL("../src/data/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../src/data/world-dots.json", import.meta.url),
  JSON.stringify(pts),
);
console.log(`world-dots.json: ${pts.length / 2} land points`);
