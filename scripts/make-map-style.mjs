// Builds the custom "abyss" MapLibre style for Le Phare.
// Starts from OpenFreeMap's dark style (free vector tiles, no key),
// strips roads / POIs / buildings / transit, and recolors every remaining
// layer to the design tokens. Output: public/map/abyss.json
//
// Run: node scripts/make-map-style.mjs

import { writeFileSync, mkdirSync } from "node:fs";

const TOKENS = {
  water: "#0A1622", // the abyss is the canvas
  land: "#12242F",
  landSubtle: "#102130",
  boundary: "rgba(232,237,242,0.18)",
  labelPlace: "#8FA3B5",
  labelWater: "#5E7C93",
  halo: "#0A1622",
};

const res = await fetch("https://tiles.openfreemap.org/styles/dark");
if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
const style = await res.json();

const KEEP = (layer) => {
  if (layer.id === "background") return true;
  const sl = layer["source-layer"];
  if (layer.type === "fill" && (sl === "water" || sl === "landcover")) return sl === "water";
  if (layer.type === "line" && sl === "boundary") {
    return true;
  }
  if (layer.type === "symbol" && sl === "place") {
    // countries and major cities only — a watch room, not a road atlas
    return /country|city/.test(layer.id);
  }
  if (layer.type === "symbol" && sl === "water_name") return true;
  return false;
};

style.layers = style.layers.filter(KEEP).map((layer) => {
  const l = structuredClone(layer);
  if (l.id === "background") {
    l.paint = { "background-color": TOKENS.land };
  } else if (l.type === "fill" && l["source-layer"] === "water") {
    l.paint = { "fill-color": TOKENS.water };
  } else if (l.type === "line" && l["source-layer"] === "boundary") {
    l.paint = {
      "line-color": TOKENS.boundary,
      "line-width": 0.8,
      "line-dasharray": [3, 3],
    };
  } else if (l.type === "symbol" && l["source-layer"] === "place") {
    l.paint = {
      "text-color": TOKENS.labelPlace,
      "text-halo-color": TOKENS.halo,
      "text-halo-width": 1.2,
    };
    if (l.layout) {
      delete l.layout["icon-image"];
      if (/country/.test(l.id)) {
        l.layout["text-transform"] = "uppercase";
        l.layout["text-letter-spacing"] = 0.12;
      }
    }
  } else if (l.type === "symbol" && l["source-layer"] === "water_name") {
    l.paint = {
      "text-color": TOKENS.labelWater,
      "text-halo-color": TOKENS.halo,
      "text-halo-width": 1,
    };
  }
  return l;
});

style.name = "Le Phare — Abyss";

mkdirSync(new URL("../public/map/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../public/map/abyss.json", import.meta.url),
  JSON.stringify(style, null, 1),
);
console.log(`abyss.json written (${style.layers.length} layers kept)`);
