// Live AIS over every monitored strait. Two feeds:
//  · Baltic — Fintraffic Digitraffic REST (open, no key, full snapshot)
//  · everywhere else — ONE aisstream.io websocket subscribed to ALL strait
//    boxes from page load: the picture accumulates in the background while
//    the visitor is still reading, so switching straits shows everything
//    already heard instead of an empty map filling one dot at a time.
//    Last-heard positions are also cached locally, so a return visit
//    starts warm instead of black.
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// aisstream key: a PUBLIC_ var ships in the client bundle by design (free,
// revocable key; the fallback keeps the deployed site live even when the
// build environment forgets the variable — rotate it at aisstream.io if abused).
const KEY =
  ((import.meta as any).env?.PUBLIC_AISSTREAM_KEY as string | undefined) ||
  "fd6fd598e436ac812a074f87ee2e269890ea8471";

type Vessel = { lon: number; lat: number; sog: number; t: number };

type Strait = {
  slug: string;
  name: string;
  center: [number, number];
  zoom: number;
  bbox?: [[number, number], [number, number]]; // [[lat,lon] SW, [lat,lon] NE]
  feed: "digitraffic" | "aisstream";
};

export const STRAITS: Strait[] = [
  { slug: "baltic", name: "Baltic (full)", center: [22.5, 59.2], zoom: 5.0, feed: "digitraffic" },
  { slug: "bab-el-mandeb", name: "Bab el-Mandeb", center: [43.3, 12.6], zoom: 7.2, bbox: [[11.7, 42.4], [13.6, 44.1]], feed: "aisstream" },
  { slug: "suez", name: "Suez", center: [32.45, 30.2], zoom: 6.8, bbox: [[29.0, 32.0], [31.7, 33.1]], feed: "aisstream" },
  { slug: "hormuz", name: "Hormuz", center: [56.5, 26.4], zoom: 7.0, bbox: [[25.4, 55.4], [27.3, 57.6]], feed: "aisstream" },
  { slug: "gibraltar", name: "Gibraltar", center: [-5.5, 36.0], zoom: 8.0, bbox: [[35.6, -6.4], [36.4, -4.8]], feed: "aisstream" },
  { slug: "dover", name: "Dover", center: [1.5, 51.05], zoom: 8.0, bbox: [[50.6, 0.7], [51.5, 2.3]], feed: "aisstream" },
  { slug: "bosphorus", name: "Bosphorus", center: [29.05, 41.1], zoom: 9.0, bbox: [[40.8, 28.7], [41.4, 29.4]], feed: "aisstream" },
  { slug: "danish-straits", name: "Danish Straits", center: [11.6, 55.7], zoom: 6.8, bbox: [[54.6, 9.4], [56.4, 13.2]], feed: "aisstream" },
  { slug: "malacca", name: "Malacca / Singapore", center: [103.5, 1.3], zoom: 7.8, bbox: [[0.9, 102.3], [1.7, 104.4]], feed: "aisstream" },
  { slug: "panama", name: "Panama", center: [-79.6, 9.1], zoom: 8.0, bbox: [[8.5, -80.2], [9.7, -79.1]], feed: "aisstream" },
  { slug: "good-hope", name: "Good Hope", center: [18.4, -34.5], zoom: 7.2, bbox: [[-35.6, 17.3], [-33.5, 19.4]], feed: "aisstream" },
  { slug: "taiwan-strait", name: "Taiwan Strait", center: [119.8, 24.3], zoom: 6.2, bbox: [[22.8, 117.3], [25.7, 121.2]], feed: "aisstream" },
  { slug: "kerch", name: "Kerch", center: [36.5, 45.2], zoom: 8.2, bbox: [[44.7, 35.9], [45.7, 37.0]], feed: "aisstream" },
];

const PRUNE_MS = 12 * 60000; // drop vessels silent for 12 min
const CACHE_KEY = "phare-ais-cache"; // warm-start store, same freshness rule

// "good picture" per strait: benchmarked against what the receiver network
// actually delivers (scripts/bench-ais.mjs) — the busy, well-covered straits
// reach these within one to two minutes of listening; the war-zone straits
// have almost no volunteer receivers and honesty beats pretending.
const GOOD: Record<string, number> = {
  "danish-straits": 150,
  dover: 40,
  gibraltar: 40,
  "good-hope": 40,
  malacca: 40,
  suez: 25,
  bosphorus: 15,
  "taiwan-strait": 5,
  panama: 3,
  "bab-el-mandeb": 2,
  hormuz: 2,
  kerch: 2,
};
// straits where shore-receiver coverage is structurally thin or nil
const THIN = new Set(["bab-el-mandeb", "hormuz", "kerch", "panama", "taiwan-strait"]);

export default function LiveStraits({ only }: { only?: string }) {
  const initial = STRAITS.find((s) => s.slug === only) ?? STRAITS[0];
  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [strait, setStrait] = useState<Strait>(initial);
  const [stats, setStats] = useState<{ total: number; moving: number; at: string } | null>(null);
  const [wsState, setWsState] = useState<"connecting" | "live" | "error">("connecting");
  const [balticState, setBalticState] = useState<"connecting" | "live" | "error">("connecting");
  // vessel stores live outside React: the websocket writes, the 2 s render
  // loop reads — no re-render per AIS message
  const world = useRef<Map<number, Vessel>>(new Map());
  const baltic = useRef<Map<number, Vessel>>(new Map());
  const heardSince = useRef<number>(Date.now());

  const state = strait.feed === "digitraffic" ? balticState : wsState;

  /* ---------- map init, once ---------- */
  useEffect(() => {
    if (!mapDiv.current) return;
    const map = new maplibregl.Map({
      container: mapDiv.current,
      style: "/map/abyss.json",
      center: initial.center,
      zoom: initial.zoom,
      attributionControl: { compact: true },
      cooperativeGestures: true,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.addSource("ais", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "ais-dots",
        type: "circle",
        source: "ais",
        paint: {
          "circle-radius": ["case", ["==", ["get", "moving"], 1], 3, 2],
          "circle-color": ["case", ["==", ["get", "moving"], 1], "#F2B950", "#5E7C93"],
          "circle-opacity": 0.85,
        },
      });
      map.on("click", "ais-dots", (e) => {
        const p = e.features![0].properties as any;
        new maplibregl.Popup({ maxWidth: "240px" })
          .setLngLat((e.features![0].geometry as any).coordinates)
          .setHTML(
            `<div style="font-family:var(--font-mono);font-size:12px;color:var(--ink);background:var(--bg-1);padding:10px 12px;border:1px solid var(--line-2)">MMSI ${p.mmsi}<br/>SOG ${p.sog ?? "?"} kn</div>`,
          )
          .addTo(map);
      });
      map.on("mouseenter", "ais-dots", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "ais-dots", () => (map.getCanvas().style.cursor = ""));
      mapRef.current = map;
      setStrait({ ...initial }); // trigger render effect once the source exists
    });
    return () => map.remove();
  }, []);

  /* ---------- ONE aisstream connection for the page's lifetime ---------- */
  useEffect(() => {
    // warm start: last-heard positions from a previous visit, same 12-min rule
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
      if (Array.isArray(c?.vessels)) {
        const now = Date.now();
        for (const [mmsi, v] of c.vessels) if (now - v.t < PRUNE_MS) world.current.set(mmsi, v);
        if (world.current.size) heardSince.current = Math.min(...[...world.current.values()].map((v) => v.t));
      }
    } catch {}

    const subs = (only ? STRAITS.filter((s) => s.slug === only) : STRAITS).filter(
      (s) => s.feed === "aisstream" && s.bbox,
    );
    if (!subs.length) return;

    let disposed = false;
    let retries = 0;
    let ws: WebSocket | null = null;
    const connect = () => {
      if (disposed) return;
      ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
      ws.onopen = () => {
        ws!.send(
          JSON.stringify({
            APIKey: KEY,
            BoundingBoxes: subs.map((s) => s.bbox), // every strait at once
            // no FilterMessageTypes: Class B craft, static-data reports and
            // everything else carry a position in MetaData too — benchmarked
            // 2.2x more unique vessels per minute than PositionReport alone
          }),
        );
        setWsState("live");
      };
      ws.onmessage = async (ev) => {
        try {
          // aisstream sends binary frames: Blob in browsers
          const txt = typeof ev.data === "string" ? ev.data : await (ev.data as Blob).text();
          const m = JSON.parse(txt);
          const meta = m.MetaData;
          if (!meta || meta.latitude == null || meta.longitude == null) return;
          retries = 0; // healthy stream
          const sog =
            m.Message?.PositionReport?.Sog ??
            m.Message?.StandardClassBPositionReport?.Sog ??
            m.Message?.ExtendedClassBPositionReport?.Sog ??
            world.current.get(meta.MMSI)?.sog ??
            0;
          world.current.set(meta.MMSI, {
            lon: meta.longitude,
            lat: meta.latitude,
            sog,
            t: Date.now(),
          });
        } catch {}
      };
      // the free tier allows one connection per key: dropped sockets are
      // normal when another tab or the weekly sampler holds the line.
      // Back off and retry a few times before declaring the feed down.
      ws.onclose = () => {
        if (disposed) return;
        if (retries < 4) {
          retries += 1;
          setWsState("connecting");
          window.setTimeout(connect, 3000 * retries);
        } else {
          setWsState("error");
        }
      };
      ws.onerror = () => ws?.close();
    };
    connect();

    // persist the picture so the next visit starts warm
    const save = window.setInterval(() => {
      try {
        const arr = [...world.current.entries()].slice(-4000);
        localStorage.setItem(CACHE_KEY, JSON.stringify({ vessels: arr }));
      } catch {}
    }, 10000);

    return () => {
      disposed = true;
      clearInterval(save);
      ws?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- Digitraffic snapshot, polled while the Baltic is shown ---------- */
  useEffect(() => {
    if (strait.feed !== "digitraffic") return;
    let disposed = false;
    if (!baltic.current.size) setBalticState("connecting");
    const load = async () => {
      try {
        const r = await fetch("https://meri.digitraffic.fi/api/ais/v1/locations", {
          headers: { "Digitraffic-User": "LePhare/observatory" },
        });
        const d = await r.json();
        if (disposed) return;
        baltic.current.clear();
        for (const f of d.features)
          baltic.current.set(f.mmsi, {
            lon: f.geometry.coordinates[0],
            lat: f.geometry.coordinates[1],
            sog: f.properties.sog ?? 0,
            t: Date.now(),
          });
        setBalticState("live");
      } catch {
        if (!disposed) setBalticState("error");
      }
    };
    load();
    const timer = window.setInterval(load, 10000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [strait.feed]);

  /* ---------- render loop: publish the selected strait every 2 s ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ center: strait.center, zoom: strait.zoom, duration: 900 });
    setStats(null);

    const push = () => {
      const now = Date.now();
      const store = strait.feed === "digitraffic" ? baltic.current : world.current;
      for (const [k, v] of store) if (now - v.t > PRUNE_MS) store.delete(k);
      const box = strait.bbox;
      const feats = [...store.entries()]
        .filter(
          ([, v]) => !box || (v.lat >= box[0][0] && v.lat <= box[1][0] && v.lon >= box[0][1] && v.lon <= box[1][1]),
        )
        .map(([mmsi, v]) => ({
          type: "Feature" as const,
          properties: { mmsi, sog: v.sog, moving: v.sog > 0.5 ? 1 : 0 },
          geometry: { type: "Point" as const, coordinates: [v.lon, v.lat] },
        }));
      (map.getSource("ais") as maplibregl.GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: feats,
      });
      setStats({
        total: feats.length,
        moving: feats.filter((f) => f.properties.moving).length,
        at: new Date().toLocaleTimeString("en-GB", { timeZone: "UTC" }) + " UTC",
      });
    };
    push();
    const timer = window.setInterval(push, 2000);
    return () => clearInterval(timer);
  }, [strait]);

  const heardMin = Math.max(1, Math.round((Date.now() - heardSince.current) / 60000));

  return (
    <div>
      <div className={only ? "hidden" : "mb-4 flex flex-wrap gap-2"}>
        {STRAITS.map((s) => (
          <button
            key={s.slug}
            aria-pressed={strait.slug === s.slug}
            onClick={() => setStrait(s)}
            className={`t-caps cursor-pointer border rounded-r1 px-2.5 py-1.5 transition-all duration-150 ${
              strait.slug === s.slug ? "border-[color:var(--accent)] !text-accent-text" : "border-line-2 !text-ink-3"
            }`}
          >
            {s.name}
          </button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <p className="t-meta" aria-live="polite">
          {state === "error"
            ? "feed unreachable · pick another strait or come back in a minute"
            : stats && stats.total > 0
              ? `${stats.total} vessels · ${stats.moving} underway · ${
                  strait.feed === "aisstream"
                    ? `picture ${stats.total >= (GOOD[strait.slug] ?? 20) ? "good" : "building"} (target ${GOOD[strait.slug] ?? 20}) · heard over the last ${Math.min(heardMin, 12)} min`
                    : "full snapshot"
                } · updated ${stats.at}`
              : state === "connecting"
                ? "connecting to live feed…"
                : THIN.has(strait.slug)
                  ? "listening… coverage is structurally thin here: few or no volunteer shore receivers (war zone / jamming), not a bug"
                  : "listening… every strait accumulates in the background from page load"}
        </p>
        <p className="t-meta">
          <span className="mr-3"><span className="mr-1.5 inline-block size-[7px] align-middle" style={{ background: "var(--accent)" }} />underway</span>
          <span><span className="mr-1.5 inline-block size-[7px] align-middle" style={{ background: "#5E7C93" }} />moored / anchored</span>
        </p>
      </div>
      <div
        ref={mapDiv}
        className="h-[500px] w-full border border-line-2 [&_.maplibregl-popup-content]:!bg-transparent [&_.maplibregl-popup-content]:!p-0 [&_.maplibregl-popup-content]:!shadow-none [&_.maplibregl-popup-tip]:!border-t-[color:var(--bg-1)] [&_.maplibregl-ctrl-attrib]:!bg-bg-1 [&_.maplibregl-ctrl-attrib]:!text-ink-3 [&_.maplibregl-ctrl-attrib]:!text-[10px] [&_.maplibregl-popup-close-button]:!text-ink-2"
      />
      <p className="t-meta mt-3">
        Live AIS: Fintraffic Digitraffic (Baltic, CC BY 4.0) · aisstream.io — one
        stream over all twelve straits, listening from the moment the page
        opens, last picture cached locally · coverage relies on volunteer shore
        receivers and can run thin (Hormuz notably, where jamming also
        suppresses AIS) · vessels fade after 12 min of silence
      </p>
    </div>
  );
}
