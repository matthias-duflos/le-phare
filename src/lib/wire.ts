// The alerts wire, shared by the feed list and the map pins.
// Articles come from the wire snapshot (public/data/wire.json), written by
// scripts/fetch-wire.mjs on the 6-hour refresh cron. GDELT's DOC API sends
// no CORS headers, so the browser cannot query it directly — the snapshot
// IS the freshest picture a static page can honestly serve.
// GDELT articles carry no coordinates: pins are geocoded by matching
// maritime place keywords in the title — approximate by design, and said so.

export type WireArticle = { url: string; title: string; domain: string; seendate: string };

let inflight: Promise<{ articles: WireArticle[]; snapshot: string | null }> | null = null;

/** 7-day article list from the latest wire snapshot (cron-refreshed every 6 h).
    Concurrent callers (feed list + map pins) share a single request; a page
    left open re-reads the snapshot after 15 min to pick up cron refreshes. */
export function getWireArticles() {
  if (!inflight) {
    inflight = fetchWireArticles().finally(() => {
      setTimeout(() => (inflight = null), 15 * 60000);
    });
  }
  return inflight;
}

async function fetchWireArticles(): Promise<{ articles: WireArticle[]; snapshot: string | null }> {
  try {
    const r = await fetch("/data/wire.json", { cache: "no-cache" });
    const d = await r.json();
    return { articles: d.articles ?? [], snapshot: d.fetched?.slice(0, 10) ?? "" };
  } catch {
    return { articles: [], snapshot: null };
  }
}

/* keyword gazetteer: first match wins, most specific first */
const PLACES: Array<[RegExp, [number, number]]> = [
  [/bab[ -]el[ -]mandeb/i, [12.6, 43.4]],
  [/gulf of aden/i, [12.8, 47.5]],
  [/red sea/i, [17.5, 39.5]],
  [/hormuz/i, [26.5, 56.5]],
  [/gulf of oman/i, [24.5, 58.5]],
  [/persian gulf|arabian gulf/i, [26.5, 52.0]],
  [/suez/i, [30.0, 32.5]],
  [/houthi|yemen/i, [14.8, 43.0]],
  [/somali/i, [4.0, 49.0]],
  [/singapore strait|phillip channel/i, [1.15, 103.7]],
  [/malacca/i, [2.5, 101.4]],
  [/singapore/i, [1.2, 103.9]],
  [/south china sea/i, [12.0, 114.0]],
  [/taiwan/i, [24.2, 119.5]],
  [/sulu|celebes/i, [5.5, 120.5]],
  [/gulf of guinea/i, [2.5, 4.0]],
  [/lagos|nigeria/i, [5.5, 4.8]],
  [/gabon/i, [0.3, 9.0]],
  [/ghana/i, [4.9, -0.9]],
  [/ivory coast|c[oô]te d.ivoire/i, [4.6, -4.2]],
  [/cameroon|douala/i, [3.7, 9.4]],
  [/equatorial guinea|malabo/i, [3.5, 8.5]],
  [/kerch/i, [45.2, 36.5]],
  [/odesa|odessa/i, [46.1, 30.9]],
  [/crimea|sevastopol/i, [44.4, 33.2]],
  [/bosphorus|bosporus/i, [41.1, 29.1]],
  [/black sea/i, [43.5, 33.0]],
  [/gulf of finland/i, [59.8, 25.0]],
  [/kaliningrad/i, [55.0, 19.5]],
  [/baltic/i, [57.5, 20.0]],
  [/danish strait|oresund|great belt/i, [55.9, 12.6]],
  [/north sea/i, [55.5, 4.0]],
  [/dover|english channel/i, [50.9, 1.4]],
  [/gibraltar/i, [35.9, -5.6]],
  [/mozambique/i, [-17.0, 41.0]],
  [/cape of good hope|south africa/i, [-34.9, 18.4]],
  [/sri lanka|colombo/i, [6.5, 80.5]],
  [/bangladesh|chattogram|chittagong/i, [22.1, 91.7]],
  [/indian ocean/i, [-5.0, 72.0]],
  [/panama/i, [9.1, -79.7]],
  [/venezuela/i, [11.0, -64.5]],
  [/haiti/i, [19.5, -73.0]],
  [/peru|callao/i, [-12.0, -77.4]],
  [/ecuador|guayaquil/i, [-2.6, -80.4]],
];

const SEVERE = /missile|drone|struck|explosion|blast|killed|dead|casualt|injur|hijack|kidnap|abduct|fired upon|under attack|attack(ed|s)? (on|a|the)|sinking|sank|ablaze|on fire/i;
const INCIDENT = /board|robber|piracy|pirate|seiz|detain|theft|arrest|intercept|stowaway|mine\b/i;

export type WirePin = WireArticle & { lat: number; lon: number; severity: "severe" | "incident" | "signal" };

/** Geocode + grade a headline; null when no maritime place matches. */
export function wirePin(a: WireArticle): WirePin | null {
  const hit = PLACES.find(([re]) => re.test(a.title));
  if (!hit) return null;
  // deterministic jitter from the title so co-located pins fan out but stay put
  let h = 0;
  for (let i = 0; i < a.title.length; i++) h = (h * 31 + a.title.charCodeAt(i)) | 0;
  const jx = ((h & 0xff) / 255 - 0.5) * 1.6;
  const jy = (((h >> 8) & 0xff) / 255 - 0.5) * 1.6;
  return {
    ...a,
    lat: hit[1][0] + jy,
    lon: hit[1][1] + jx,
    severity: SEVERE.test(a.title) ? "severe" : INCIDENT.test(a.title) ? "incident" : "signal",
  };
}

/** "20260717T093000Z" → ms epoch. */
export function wireTime(seendate: string): number {
  return Date.parse(
    `${seendate.slice(0, 4)}-${seendate.slice(4, 6)}-${seendate.slice(6, 8)}T${seendate.slice(9, 11)}:${seendate.slice(11, 13)}:${seendate.slice(13, 15)}Z`,
  );
}
