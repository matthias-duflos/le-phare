// Live AIS over every monitored strait. Two feeds:
//  · Baltic — Fintraffic Digitraffic REST (open, no key, full snapshot)
//  · everywhere else — aisstream.io websocket (free key, positions accumulate
//    as vessels broadcast; a busy strait fills in seconds)
// Pills switch strait; the map reconnects to the selected feed.
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const KEY = (import.meta as any).env?.PUBLIC_AISSTREAM_KEY as string | undefined;

type Strait = {
  slug: string;
  name: string;
  center: [number, number];
  zoom: number;
  bbox?: [[number, number], [number, number]]; // [[lat,lon] SW, [lat,lon] NE]
  feed: "digitraffic" | "aisstream";
};

const STRAITS: Strait[] = [
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

export default function LiveStraits() {
  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [strait, setStrait] = useState<Strait>(STRAITS[0]);
  const [stats, setStats] = useState<{ total: number; moving: number; at: string } | null>(null);
  const [state, setState] = useState<"connecting" | "live" | "nokey" | "error">("connecting");

  // map init once
  useEffect(() => {
    if (!mapDiv.current) return;
    const map = new maplibregl.Map({
      container: mapDiv.current,
      style: "/map/abyss.json",
      center: STRAITS[0].center,
      zoom: STRAITS[0].zoom,
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
      setStrait({ ...STRAITS[0] }); // trigger feed effect after source exists
    });
    return () => map.remove();
  }, []);

  // feed per strait
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ center: strait.center, zoom: strait.zoom, duration: 900 });

    const vessels = new Map<number, { lon: number; lat: number; sog: number; t: number }>();
    let disposed = false;
    let timer = 0;
    let ws: WebSocket | null = null;
    setStats(null);

    const push = () => {
      const now = Date.now();
      for (const [k, v] of vessels) if (now - v.t > PRUNE_MS) vessels.delete(k);
      const feats = [...vessels.entries()].map(([mmsi, v]) => ({
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

    if (strait.feed === "digitraffic") {
      setState("connecting");
      const load = async () => {
        try {
          const r = await fetch("https://meri.digitraffic.fi/api/ais/v1/locations", {
            headers: { "Digitraffic-User": "LePhare/observatory" },
          });
          const d = await r.json();
          if (disposed) return;
          vessels.clear();
          for (const f of d.features)
            vessels.set(f.mmsi, {
              lon: f.geometry.coordinates[0],
              lat: f.geometry.coordinates[1],
              sog: f.properties.sog ?? 0,
              t: Date.now(),
            });
          push();
          setState("live");
        } catch {
          if (!disposed) setState("error");
        }
      };
      load();
      timer = window.setInterval(load, 10000);
    } else if (!KEY) {
      setState("nokey");
      push();
    } else {
      setState("connecting");
      ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
      ws.onopen = () => {
        ws!.send(
          JSON.stringify({
            APIKey: KEY,
            BoundingBoxes: [strait.bbox],
            FilterMessageTypes: ["PositionReport"],
          }),
        );
        setState("live");
      };
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data);
          const meta = m.MetaData;
          const pr = m.Message?.PositionReport;
          if (!meta || !pr) return;
          vessels.set(meta.MMSI, {
            lon: meta.longitude,
            lat: meta.latitude,
            sog: pr.Sog ?? 0,
            t: Date.now(),
          });
        } catch {}
      };
      ws.onerror = () => !disposed && setState("error");
      timer = window.setInterval(push, 2000);
    }

    return () => {
      disposed = true;
      clearInterval(timer);
      ws?.close();
    };
  }, [strait]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
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
          {state === "nokey"
            ? "aisstream key missing · add PUBLIC_AISSTREAM_KEY to site/.env (free key at aisstream.io) · Baltic works without it"
            : state === "error"
              ? "feed unreachable · retrying on next switch"
              : state === "connecting"
                ? "connecting to live feed…"
                : stats
                  ? `${stats.total} vessels · ${stats.moving} underway · ${strait.feed === "aisstream" ? "accumulating live broadcasts" : "full snapshot"} · updated ${stats.at}`
                  : "…"}
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
        Live AIS: Fintraffic Digitraffic (Baltic, CC BY 4.0) · aisstream.io
        (world straits, positions as broadcast) · vessels fade after 12 min of
        silence
      </p>
    </div>
  );
}
