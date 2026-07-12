// Custom-styled MapLibre panel with the observatory's motion language:
// a slow camera drift on entry, a flowing shipping lane (animated dash),
// a vessel moving along it, and pulsing incident markers.
// Everything collapses to a static frame under prefers-reduced-motion.
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

interface Props {
  center?: [number, number];
  zoom?: number;
  height?: number;
}

// Suez approaches → Red Sea → Bab el-Mandeb → Gulf of Aden → Indian Ocean
const LANE: [number, number][] = [
  [32.6, 29.6],
  [33.9, 27.2],
  [35.2, 24.4],
  [37.2, 21.2],
  [38.8, 18.4],
  [40.2, 15.8],
  [42.0, 13.6],
  [43.4, 12.5],
  [45.2, 12.2],
  [48.0, 12.6],
  [51.2, 12.9],
  [54.5, 13.4],
];

// cumulative segment lengths for constant-speed interpolation
const segLen = LANE.slice(1).map((p, i) => Math.hypot(p[0] - LANE[i][0], p[1] - LANE[i][1]));
const total = segLen.reduce((a, b) => a + b, 0);
const pointAt = (f: number): [number, number] => {
  let d = f * total;
  for (let i = 0; i < segLen.length; i++) {
    if (d <= segLen[i]) {
      const t = d / segLen[i];
      return [
        LANE[i][0] + (LANE[i + 1][0] - LANE[i][0]) * t,
        LANE[i][1] + (LANE[i + 1][1] - LANE[i][1]) * t,
      ];
    }
    d -= segLen[i];
  }
  return LANE[LANE.length - 1];
};

// dash phases cycled to make the lane flow (classic MapLibre technique)
const DASH_SEQ: number[][] = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
  [0, 0.5, 3, 3.5],
  [0, 1, 3, 3],
  [0, 1.5, 3, 2.5],
  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],
  [0, 3, 3, 1],
  [0, 3.5, 3, 0.5],
];

export default function MapPanel({
  center = [46.8, 12.4],
  zoom = 5.1,
  height = 420,
}: Props) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const map = new maplibregl.Map({
      container: container.current,
      style: "/map/abyss.json",
      center: reduce ? center : [center[0] - 2.2, center[1] + 0.8],
      zoom: reduce ? zoom : zoom - 0.7,
      bearing: reduce ? 0 : -6,
      attributionControl: { compact: true },
      cooperativeGestures: true,
      fadeDuration: reduce ? 0 : 300,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    let raf = 0;
    let dashTimer = 0;

    map.on("load", () => {
      // ---- shipping lane ----
      map.addSource("lane", {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: LANE } },
      });
      map.addLayer({
        id: "lane-base",
        type: "line",
        source: "lane",
        paint: { "line-color": "#F2B950", "line-opacity": 0.14, "line-width": 2.5 },
      });
      map.addLayer({
        id: "lane-flow",
        type: "line",
        source: "lane",
        paint: {
          "line-color": "#F2B950",
          "line-opacity": 0.55,
          "line-width": 1.6,
          "line-dasharray": DASH_SEQ[0],
        },
      });

      // ---- moving vessel ----
      map.addSource("vessel", {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: pointAt(0) } },
      });
      map.addLayer({
        id: "vessel-dot",
        type: "circle",
        source: "vessel",
        paint: {
          "circle-radius": 3.5,
          "circle-color": "#F2B950",
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "rgba(242,185,80,0.35)",
        },
      });

      // ---- incident markers (sample data), pulsing ----
      const samples: Array<{ lng: number; lat: number; risk: boolean }> = [
        { lng: 43.3, lat: 12.6, risk: true },
        { lng: 44.9, lat: 12.9, risk: true },
        { lng: 47.2, lat: 13.4, risk: false },
        { lng: 42.6, lat: 14.8, risk: false },
      ];
      for (const s of samples) {
        const el = document.createElement("span");
        el.className = s.risk ? "map-marker map-marker-risk" : "map-marker";
        new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(map);
      }

      if (reduce) return;

      // camera drift: the watch room leans in
      map.easeTo({ center, zoom, bearing: 0, duration: 2600, easing: (t) => 1 - Math.pow(1 - t, 3) });

      // lane flow
      let dashStep = 0;
      dashTimer = window.setInterval(() => {
        dashStep = (dashStep + 1) % DASH_SEQ.length;
        if (map.getLayer("lane-flow")) {
          map.setPaintProperty("lane-flow", "line-dasharray", DASH_SEQ[dashStep]);
        }
      }, 90);

      // vessel along the lane (one full transit ≈ 40 s)
      const t0 = performance.now();
      const drive = (t: number) => {
        const f = ((t - t0) / 40000) % 1;
        (map.getSource("vessel") as maplibregl.GeoJSONSource | undefined)?.setData({
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: pointAt(f) },
        });
        raf = requestAnimationFrame(drive);
      };
      raf = requestAnimationFrame(drive);
    });

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(dashTimer);
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={container}
      style={{ height }}
      className="w-full border border-line-2 [&_.maplibregl-ctrl-attrib]:!bg-bg-1 [&_.maplibregl-ctrl-attrib]:!text-ink-3 [&_.maplibregl-ctrl-attrib_a]:!text-ink-3 [&_.maplibregl-ctrl-attrib]:!text-[10px]"
    />
  );
}
