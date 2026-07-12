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

const CHOKEPOINTS: Array<{ name: string; slug: string; lnglat: [number, number] }> = [
  { name: "Bab el-Mandeb", slug: "bab-el-mandeb", lnglat: [43.4, 12.6] },
  { name: "Suez", slug: "suez", lnglat: [32.5, 30] },
  { name: "Good Hope", slug: "good-hope", lnglat: [18.4, -34.9] },
  { name: "Hormuz", slug: "hormuz", lnglat: [56.5, 26.5] },
  { name: "Malacca", slug: "malacca", lnglat: [100.5, 3] },
  { name: "Gibraltar", slug: "gibraltar", lnglat: [-5.6, 35.9] },
  { name: "Panama", slug: "panama", lnglat: [-79.7, 9.1] },
  { name: "Bosphorus", slug: "bosphorus", lnglat: [29.1, 41.1] },
  { name: "Danish Straits", slug: "danish-straits", lnglat: [12.6, 55.9] },
  { name: "Dover", slug: "dover", lnglat: [1.5, 51.05] },
  { name: "Taiwan Strait", slug: "taiwan-strait", lnglat: [119.5, 24.5] },
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
      // interactive, but only as a globe you can spin: no zoom, no pitch
      interactive: true,
      dragPan: true,
      dragRotate: false,
      scrollZoom: false,
      doubleClickZoom: false,
      touchZoomRotate: false,
      touchPitch: false,
      keyboard: false,
      maxPitch: 0,
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
      for (const { name, slug, lnglat } of CHOKEPOINTS) {
        const el = document.createElement("a");
        el.className = "map-marker map-marker-link";
        el.href = `/straits#${slug}`;
        el.setAttribute("aria-label", `${name} strait monitor`);
        el.style.width = "9px";
        el.style.height = "9px";
        const label = document.createElement("span");
        label.className = "map-marker-label";
        label.textContent = name;
        el.appendChild(label);
        new maplibregl.Marker({ element: el, opacityWhenCovered: "0" })
          .setLngLat(lnglat)
          .addTo(map);
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
    let last = 0;
    let lastReadout = 0;
    let userUntil = 0; // auto-spin holds off until this timestamp
    let rampFrom = 0; // spin eases back in after user interaction
    const readout = document.getElementById("globe-readout");
    const fmtLng = (l: number) =>
      `${Math.abs(l).toFixed(1).padStart(5, "0")}°${l >= 0 ? "E" : "W"}`;
    const fmtLat = (l: number) =>
      `${Math.abs(l).toFixed(1).padStart(4, "0")}°${l >= 0 ? "N" : "S"}`;

    const spin = (now: number) => {
      const dt = last ? (now - last) / 1000 : 0;
      last = now;
      const c = map.getCenter();
      const idle = now >= userUntil && !map.isMoving();
      if (idle && dt) {
        if (!rampFrom) rampFrom = now;
        const ramp = Math.min((now - rampFrom) / 1500, 1); // ease back in
        const lat = Math.max(Math.min(c.lat, 55), -55);
        map.jumpTo({ center: [c.lng - DEG_PER_SEC * dt * ramp, lat] });
      } else if (!idle) {
        rampFrom = 0;
      }
      if (readout && now - lastReadout > 180) {
        lastReadout = now;
        readout.textContent = `CAM ${fmtLng(c.lng)} ${fmtLat(c.lat)} · ROT ${idle ? "0.55°/s" : "MANUAL"} · VIIRS NIGHT`;
      }
      raf = requestAnimationFrame(spin);
    };
    const start = () => {
      if (!running && !reduce) {
        running = true;
        last = 0;
        raf = requestAnimationFrame(spin);
      }
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    // hand control to the user while they drag; resume gently after idle
    const hold = () => {
      userUntil = performance.now() + 2500;
    };
    map.on("dragstart", hold);
    map.on("drag", hold);
    map.on("dragend", () => {
      userUntil = performance.now() + 2500;
    });
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
      className="absolute inset-0"
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
