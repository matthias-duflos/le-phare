// The home hero: a living world map drawn in canvas.
// Land is a dotted grid (Natural Earth 110m, precomputed), the world's main
// trade lanes flow with slow particles, and the six monitored chokepoints
// pulse in amber. Editorial meaning: the observatory watches the whole board.
// Static under prefers-reduced-motion; pauses offscreen; theme-aware.
import { useEffect, useRef } from "react";
import dotsRaw from "../../data/world-dots.json";

type Pt = [number, number]; // lon, lat

// Main trade lanes (approximate waypoints). Transpacific is split at the
// antimeridian into two lanes so interpolation never crosses the map.
const ROUTES: Pt[][] = [
  // Asia → Suez → North Europe
  [[121.8, 31.2], [117, 24], [110, 15], [103.8, 1.3], [95, 5.5], [80, 6], [60, 13], [50.5, 13], [43.4, 12.6], [38, 19], [33.9, 27.2], [32.5, 30], [22, 34], [10, 37.2], [-5.6, 35.9], [-9.5, 38], [-5, 48.5], [4.1, 52]],
  // Cape of Good Hope rerouting
  [[103.8, 1.3], [95, 5.5], [75, 3], [55, -10], [35, -28], [18.4, -34.9], [8, -20], [-5, 0], [-14, 15], [-18, 28], [-10, 38], [-5, 48.5]],
  // Gulf → Asia
  [[56.5, 26.5], [58, 24], [65, 18], [75, 8], [95, 5.5], [103.8, 1.3], [110, 8], [121.8, 31.2]],
  // Transatlantic
  [[4.1, 52], [-5, 48.5], [-30, 45], [-55, 42], [-74, 40.5]],
  // Transpacific (west half)
  [[121.8, 31.2], [135, 33], [150, 38], [165, 43], [180, 45]],
  // Transpacific (east half)
  [[-180, 45], [-160, 43], [-140, 38], [-125, 35], [-118.3, 33.9]],
  // US East Coast → Panama → US West Coast
  [[-74, 40.5], [-75, 32], [-76, 20], [-79.7, 9.1], [-82, 6], [-95, 14], [-110, 22], [-118.3, 33.9]],
  // Brazil → Gibraltar approaches
  [[-46.3, -24.1], [-38, -15], [-32, -5], [-25, 5], [-18, 28], [-10, 36]],
  // Australia → Singapore
  [[115.9, -32.1], [110, -20], [105, -8], [103.8, 1.3]],
];

// The six monitored chokepoints
const CHOKEPOINTS: Pt[] = [
  [43.4, 12.6], // Bab el-Mandeb
  [32.5, 30], // Suez
  [18.4, -34.9], // Cape of Good Hope
  [56.5, 26.5], // Hormuz
  [100.5, 3], // Malacca
  [-5.6, 35.9], // Gibraltar
];

const LAT_MAX = 74;
const LAT_MIN = -58;
const LAT_SPAN = LAT_MAX - LAT_MIN;

interface Particle {
  route: number;
  d: number; // distance travelled along route
  speed: number;
  amber: boolean;
  size: number;
}

export default function HeroMap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rootStyle = getComputedStyle(document.documentElement);
    let inkDot = "", steel = "", amber = "";
    const readColors = () => {
      inkDot = rootStyle.getPropertyValue("--ink-3").trim() || "#71869B";
      steel = rootStyle.getPropertyValue("--viz-context").trim() || "#3E5468";
      amber = rootStyle.getPropertyValue("--accent").trim() || "#F2B950";
    };
    readColors();

    // projection: equirectangular, "cover" the canvas, biased north
    let w = 0, h = 0, dpr = 1, scale = 1, ox = 0, oy = 0;
    const project = (lon: number, lat: number): [number, number] => [
      ox + (lon + 180) * scale,
      oy + (LAT_MAX - lat) * scale,
    ];
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      scale = Math.max(w / 360, (h * 1.06) / LAT_SPAN);
      ox = (w - 360 * scale) / 2;
      // bias the crop toward the northern lanes (lat ~22 at vertical center)
      oy = h / 2 - (LAT_MAX - 22) * scale;
      drawBase();
    };

    // route geometry in projected space, recomputed on resize
    let segs: { p: [number, number][]; len: number[]; total: number }[] = [];
    const buildRoutes = () => {
      segs = ROUTES.map((r) => {
        const p = r.map(([lon, lat]) => project(lon, lat));
        const len = p.slice(1).map((q, i) => Math.hypot(q[0] - p[i][0], q[1] - p[i][1]));
        return { p, len, total: len.reduce((a, b) => a + b, 0) };
      });
    };
    const pointOnRoute = (ri: number, d: number): [number, number] => {
      const s = segs[ri];
      for (let i = 0; i < s.len.length; i++) {
        if (d <= s.len[i]) {
          const t = s.len[i] ? d / s.len[i] : 0;
          return [
            s.p[i][0] + (s.p[i + 1][0] - s.p[i][0]) * t,
            s.p[i][1] + (s.p[i + 1][1] - s.p[i][1]) * t,
          ];
        }
        d -= s.len[i];
      }
      return s.p[s.p.length - 1];
    };

    // static base layer: land dots + faint chokepoint anchors (own canvas)
    const base = document.createElement("canvas");
    const bctx = base.getContext("2d")!;
    const dots = dotsRaw as number[];
    const drawBase = () => {
      base.width = canvas.width;
      base.height = canvas.height;
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      bctx.clearRect(0, 0, w, h);
      bctx.fillStyle = inkDot;
      bctx.globalAlpha = 0.38;
      const r = Math.max(scale * 0.36, 0.8);
      for (let i = 0; i < dots.length; i += 2) {
        const [x, y] = project(dots[i], dots[i + 1]);
        if (y < -4 || y > h + 4) continue;
        bctx.beginPath();
        bctx.arc(x, y, r, 0, Math.PI * 2);
        bctx.fill();
      }
      bctx.globalAlpha = 1;
      buildRoutes();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const totalLen = () => segs.reduce((a, s) => a + s.total, 0);
    const particles: Particle[] = [];
    const spawn = () => {
      particles.length = 0;
      const budget = 260;
      segs.forEach((s, ri) => {
        const n = Math.max(6, Math.round((s.total / totalLen()) * budget));
        for (let i = 0; i < n; i++) {
          particles.push({
            route: ri,
            d: Math.random() * s.total,
            speed: rand(0.12, 0.3),
            amber: Math.random() < 0.06,
            size: rand(0.8, 1.8),
          });
        }
      });
    };
    spawn();

    const drawChokepoints = (t: number) => {
      CHOKEPOINTS.forEach(([lon, lat], i) => {
        const [x, y] = project(lon, lat);
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = amber;
        ctx.globalAlpha = 0.9;
        ctx.fill();
        if (!reduce) {
          const phase = ((t / 2600 + i * 0.37) % 1 + 1) % 1;
          ctx.beginPath();
          ctx.arc(x, y, 2.2 + phase * 20, 0, Math.PI * 2);
          ctx.strokeStyle = amber;
          ctx.globalAlpha = (1 - phase) * 0.5;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      });
    };

    const drawParticlesStatic = () => {
      for (const p of particles) {
        const [x, y] = pointOnRoute(p.route, p.d);
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.amber ? amber : steel;
        ctx.globalAlpha = p.amber ? 0.9 : 0.55;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    if (reduce) {
      ctx.drawImage(base, 0, 0, w, h);
      drawParticlesStatic();
      drawChokepoints(0);
      return () => ro.disconnect();
    }

    // trail layer for particles (kept separate so land dots stay crisp)
    const trail = document.createElement("canvas");
    const tctx = trail.getContext("2d")!;

    let raf = 0;
    let running = false;
    const frame = (now: number) => {
      if (trail.width !== canvas.width) {
        trail.width = canvas.width;
        trail.height = canvas.height;
        tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      tctx.globalCompositeOperation = "destination-out";
      tctx.fillStyle = "rgba(0,0,0,0.10)";
      tctx.fillRect(0, 0, w, h);
      tctx.globalCompositeOperation = "source-over";

      for (const p of particles) {
        p.d += p.speed * (p.amber ? 1.4 : 1);
        const s = segs[p.route];
        if (p.d > s.total) p.d = 0;
        const [x, y] = pointOnRoute(p.route, p.d);
        tctx.beginPath();
        tctx.arc(x, y, p.size, 0, Math.PI * 2);
        tctx.fillStyle = p.amber ? amber : steel;
        tctx.globalAlpha = p.amber ? 0.95 : 0.62;
        tctx.fill();
      }
      tctx.globalAlpha = 1;

      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(base, 0, 0, w, h);
      ctx.drawImage(trail, 0, 0, w, h);
      drawChokepoints(now);

      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (!running) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop()), {
      threshold: 0.05,
    });
    io.observe(canvas);

    const mo = new MutationObserver(() => {
      readColors();
      drawBase();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{
        maskImage: "linear-gradient(to bottom, transparent 0%, black 12%, black 82%, transparent 100%)",
        WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 12%, black 82%, transparent 100%)",
      }}
    />
  );
}
