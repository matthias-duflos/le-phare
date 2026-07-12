// Shipping-lane particle field — the living background of the observatory.
// Canvas 2D: particles drift along curved maritime routes, most in faint
// steel-blue, a few in amber (the watched ones). Editorial meaning: traffic
// keeps moving through the dark; the beam picks out what matters.
// Pauses offscreen, static under prefers-reduced-motion, DPR-aware.
import { useEffect, useRef } from "react";

type Lane = { p0: [number, number]; p1: [number, number]; p2: [number, number]; p3: [number, number] };

// Cubic bézier lanes in normalized [0,1] space, drawn like great circles.
const LANES: Lane[] = [
  { p0: [-0.05, 0.78], p1: [0.25, 0.55], p2: [0.55, 0.72], p3: [1.05, 0.42] },
  { p0: [-0.05, 0.55], p1: [0.35, 0.42], p2: [0.6, 0.58], p3: [1.05, 0.3] },
  { p0: [-0.05, 0.9], p1: [0.3, 0.75], p2: [0.7, 0.88], p3: [1.05, 0.62] },
  { p0: [-0.05, 0.35], p1: [0.4, 0.28], p2: [0.65, 0.42], p3: [1.05, 0.16] },
  { p0: [0.1, 1.05], p1: [0.35, 0.8], p2: [0.5, 0.62], p3: [1.05, 0.5] },
];

const bez = (l: Lane, t: number): [number, number] => {
  const u = 1 - t;
  const x = u * u * u * l.p0[0] + 3 * u * u * t * l.p1[0] + 3 * u * t * t * l.p2[0] + t * t * t * l.p3[0];
  const y = u * u * u * l.p0[1] + 3 * u * u * t * l.p1[1] + 3 * u * t * t * l.p2[1] + t * t * t * l.p3[1];
  return [x, y];
};

interface Particle {
  lane: number;
  t: number;
  speed: number;
  offset: number;
  amber: boolean;
  size: number;
}

export default function ParticleFlow({ density = 130 }: { density?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const css = getComputedStyle(document.documentElement);
    let steel = "", amber = "";
    const readColors = () => {
      steel = css.getPropertyValue("--viz-context").trim() || "#3E5468";
      amber = css.getPropertyValue("--accent").trim() || "#F2B950";
    };
    readColors();

    let w = 0, h = 0, dpr = 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const particles: Particle[] = Array.from({ length: density }, () => ({
      lane: Math.floor(Math.random() * LANES.length),
      t: Math.random(),
      speed: rand(0.00018, 0.00055),
      offset: rand(-0.018, 0.018),
      amber: Math.random() < 0.05,
      size: rand(0.7, 1.7),
    }));

    const drawStatic = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        const [x, y] = bez(LANES[p.lane], p.t);
        ctx.beginPath();
        ctx.arc(x * w, (y + p.offset) * h, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.amber ? amber : steel;
        ctx.globalAlpha = p.amber ? 0.9 : 0.5;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    if (reduce) {
      drawStatic();
      return () => ro.disconnect();
    }

    let raf = 0;
    let running = false;

    const frame = () => {
      // translucent wipe leaves short comet trails
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,0.16)";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";

      for (const p of particles) {
        p.t += p.speed * (p.amber ? 1.35 : 1);
        if (p.t > 1) {
          p.t = 0;
          p.lane = Math.floor(Math.random() * LANES.length);
          p.offset = rand(-0.018, 0.018);
        }
        const [x, y] = bez(LANES[p.lane], p.t);
        ctx.beginPath();
        ctx.arc(x * w, (y + p.offset) * h, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.amber ? amber : steel;
        ctx.globalAlpha = p.amber ? 0.95 : 0.55;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
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

    const io = new IntersectionObserver(
      ([e]) => (e.isIntersecting ? start() : stop()),
      { threshold: 0.05 },
    );
    io.observe(canvas);

    const mo = new MutationObserver(readColors);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      mo.disconnect();
    };
  }, [density]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{
        maskImage: "radial-gradient(120% 90% at 35% 45%, black 55%, transparent 100%)",
        WebkitMaskImage: "radial-gradient(120% 90% at 35% 45%, black 55%, transparent 100%)",
      }}
    />
  );
}
