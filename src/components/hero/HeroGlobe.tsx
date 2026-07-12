// The home hero: a slowly rotating night Earth (NASA VIIRS Black Marble)
// rendered as a MapLibre globe, offset to the right of the composition.
// City lights are the only light; the six monitored chokepoints pulse amber.
// Purely decorative: non-interactive, paused offscreen, static under
// prefers-reduced-motion.
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const TILES =
  "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png";

const CHOKEPOINTS: Array<[number, number]> = [
  [43.4, 12.6], // Bab el-Mandeb
  [32.5, 30], // Suez
  [18.4, -34.9], // Cape of Good Hope
  [56.5, 26.5], // Hormuz
  [100.5, 3], // Malacca
  [-5.6, 35.9], // Gibraltar
];

const START_LNG = 48;
const LAT = 14;
const DEG_PER_SEC = 0.55; // one revolution in ~11 minutes

export default function HeroGlobe() {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const layout = () => {
      const w = container.current?.clientWidth ?? 1280;
      return {
        padding: w >= 1024 ? { left: Math.round(w * 0.34), top: 0, right: 0, bottom: 0 } : { left: 0, top: 340, right: 0, bottom: 0 },
        zoom: w >= 1024 ? 2.15 : 1.3,
      };
    };
    const first = layout();

    const map = new maplibregl.Map({
      container: container.current,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
      center: [START_LNG, LAT],
      zoom: first.zoom,
      padding: first.padding,
      canvasContextAttributes: { antialias: true },
      style: {
        version: 8,
        projection: { type: "globe" },
        sky: {
          "sky-color": "rgba(0,0,0,0)",
          "horizon-color": "rgba(111,163,199,0.45)",
          "fog-color": "rgba(14,34,51,0.7)",
          "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 6, 1, 8, 0],
        },
        sources: {
          night: {
            type: "raster",
            tiles: [TILES],
            tileSize: 256,
            maxzoom: 8,
            attribution: "NASA GIBS / VIIRS Black Marble",
          },
        },
        layers: [
          {
            id: "space",
            type: "background",
            paint: { "background-color": "rgba(0,0,0,0)" },
          },
          {
            id: "night",
            type: "raster",
            source: "night",
            paint: {
              "raster-opacity": 0.94,
              "raster-contrast": 0.06,
              "raster-brightness-min": 0.02,
            },
          },
        ],
      },
    });

    map.on("load", () => {
      for (const [lng, lat] of CHOKEPOINTS) {
        const el = document.createElement("span");
        el.className = "map-marker";
        el.style.width = "9px";
        el.style.height = "9px";
        new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
      }
    });

    const onResize = () => {
      const l = layout();
      map.jumpTo({ zoom: l.zoom, padding: l.padding });
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(container.current);

    let raf = 0;
    let running = false;
    let t0 = 0;
    const spin = (now: number) => {
      if (!t0) t0 = now;
      const lng = ((START_LNG - ((now - t0) / 1000) * DEG_PER_SEC) % 360 + 540) % 360 - 180;
      map.jumpTo({ center: [lng, LAT] });
      raf = requestAnimationFrame(spin);
    };
    const start = () => {
      if (!running && !reduce) {
        running = true;
        raf = requestAnimationFrame(spin);
      }
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop()), {
      threshold: 0.05,
    });
    io.observe(container.current);

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      map.remove();
    };
  }, []);

  return (
    // outer wrapper owns the positioning: MapLibre's stylesheet forces
    // position:relative on its container, so the container can't be inset-0 itself
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{
        maskImage:
          "linear-gradient(to bottom, transparent 0%, black 10%, black 88%, transparent 100%)",
        WebkitMaskImage:
          "linear-gradient(to bottom, transparent 0%, black 10%, black 88%, transparent 100%)",
      }}
    >
      <div ref={container} className="h-full w-full [&_.maplibregl-canvas]:!outline-none" />
    </div>
  );
}
