// Live AIS over the Baltic and Gulf of Finland, from Fintraffic's open
// Digitraffic feed (CC BY 4.0, no key). Positions refresh every 10 seconds;
// polling pauses when the panel is offscreen or the tab is hidden.
// This is raw, factual AIS broadcast data shown as-is.
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const FEED = "https://meri.digitraffic.fi/api/ais/v1/locations";
const POLL_MS = 10000;

export default function LiveBaltic() {
  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [stats, setStats] = useState<{ total: number; moving: number; at: string } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!mapDiv.current) return;
    const map = new maplibregl.Map({
      container: mapDiv.current,
      style: "/map/abyss.json",
      center: [22.5, 59.2],
      zoom: 5.0,
      attributionControl: { compact: true },
      cooperativeGestures: true,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    let timer = 0;
    let visible = true;
    let pageVisible = true;

    const load = async () => {
      try {
        const res = await fetch(FEED, { headers: { "Digitraffic-User": "LePhare/observatory" } });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        for (const f of data.features) {
          f.properties.moving = f.properties.sog > 0.5 ? 1 : 0;
        }
        (map.getSource("ais") as maplibregl.GeoJSONSource | undefined)?.setData(data);
        const moving = data.features.filter((f: any) => f.properties.moving).length;
        setStats({
          total: data.features.length,
          moving,
          at: new Date(data.dataUpdatedTime).toLocaleTimeString("en-GB", { timeZone: "UTC" }) + " UTC",
        });
        setError(false);
      } catch {
        setError(true);
      }
    };

    const schedule = () => {
      clearInterval(timer);
      if (visible && pageVisible) {
        load();
        timer = window.setInterval(load, POLL_MS);
      }
    };

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
            `<div style="font-family:var(--font-mono);font-size:12px;color:var(--ink);background:var(--bg-1);padding:10px 12px;border:1px solid var(--line-2)">
              MMSI ${p.mmsi}<br/>SOG ${p.sog} kn · HDG ${p.heading === 511 ? "n/a" : p.heading + "°"}
            </div>`,
          )
          .addTo(map);
      });
      map.on("mouseenter", "ais-dots", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "ais-dots", () => (map.getCanvas().style.cursor = ""));
      schedule();
    });

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      schedule();
    });
    io.observe(mapDiv.current);
    const onVis = () => {
      pageVisible = document.visibilityState === "visible";
      schedule();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      clearInterval(timer);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      map.remove();
    };
  }, []);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <p className="t-meta" aria-live="polite">
          {error
            ? "feed unreachable · retrying"
            : stats
              ? `${stats.total} vessels · ${stats.moving} underway · updated ${stats.at}`
              : "connecting to live feed…"}
        </p>
        <p className="t-meta">
          <span className="mr-3"><span className="mr-1.5 inline-block size-[7px] align-middle" style={{ background: "var(--accent)" }} />underway</span>
          <span><span className="mr-1.5 inline-block size-[7px] align-middle" style={{ background: "#5E7C93" }} />moored / anchored</span>
        </p>
      </div>
      <div
        ref={mapDiv}
        className="h-[480px] w-full border border-line-2 [&_.maplibregl-popup-content]:!bg-transparent [&_.maplibregl-popup-content]:!p-0 [&_.maplibregl-popup-content]:!shadow-none [&_.maplibregl-popup-tip]:!border-t-[color:var(--bg-1)] [&_.maplibregl-ctrl-attrib]:!bg-bg-1 [&_.maplibregl-ctrl-attrib]:!text-ink-3 [&_.maplibregl-ctrl-attrib]:!text-[10px] [&_.maplibregl-popup-close-button]:!text-ink-2"
      />
      <p className="t-meta mt-3">
        Live AIS: Fintraffic / Digitraffic, CC BY 4.0 · positions as broadcast, ~10 s refresh ·
        coverage: Finnish and nearby Baltic waters
      </p>
    </div>
  );
}
