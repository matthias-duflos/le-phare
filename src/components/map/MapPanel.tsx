// Custom-styled MapLibre panel. Initialises only when scrolled into view
// (the Astro island uses client:visible) and respects reduced motion.
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

interface Props {
  center?: [number, number];
  zoom?: number;
  height?: number;
}

export default function MapPanel({
  center = [46.8, 12.4], // Bab el-Mandeb and Gulf of Aden
  zoom = 5.1,
  height = 420,
}: Props) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: "/map/abyss.json",
      center,
      zoom,
      attributionControl: { compact: true },
      cooperativeGestures: true,
      fadeDuration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 300,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    // Sample incident markers (styleguide demo, mock positions)
    map.on("load", () => {
      const samples: Array<{ lng: number; lat: number; risk: boolean }> = [
        { lng: 43.3, lat: 12.6, risk: true },
        { lng: 44.9, lat: 12.9, risk: true },
        { lng: 47.2, lat: 13.4, risk: false },
        { lng: 42.6, lat: 14.8, risk: false },
      ];
      for (const s of samples) {
        const el = document.createElement("span");
        el.style.cssText = `display:block;width:12px;height:12px;border:2px solid ${
          s.risk ? "var(--risk)" : "var(--accent)"
        };background:${s.risk ? "rgba(192,57,43,0.35)" : "rgba(242,185,80,0.3)"};`;
        new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(map);
      }
    });

    return () => map.remove();
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
