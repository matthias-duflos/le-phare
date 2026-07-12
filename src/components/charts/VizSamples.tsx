// Styleguide chart specimens — sample data, clearly labeled as such.
// Demonstrates the three core figure patterns of the site:
// 1. hero line vs context (the FT move), 2. stacked bars with surface gaps,
// 3. small multiples. All colors come from the shared viz theme.
import { useEffect, useRef } from "react";
import * as Plot from "@observablehq/plot";
import { readTheme, plotDefaults, onThemeChange } from "../../lib/viz";

/* ---- sample data (mock, for the styleguide only) ---- */

const weeks = Array.from({ length: 52 }, (_, i) => i + 1);

// Weekly transits, one hero series + a 2023 baseline as context.
const transits = weeks.flatMap((w) => {
  const seasonal = Math.sin((w / 52) * Math.PI * 2) * 4;
  const base = 71 + seasonal + ((w * 13) % 7) - 3;
  const shock = w < 46 ? 1 : 1 - (w - 45) * 0.09;
  const level = w < 46 ? base : Math.max(base * shock, 26);
  return [
    { week: w, series: "2023 baseline", value: Math.round(base) },
    { week: w, series: "2024", value: Math.round(level - (w > 45 ? 0 : 2)) },
  ];
});

const incidentTypes = [
  "Drone strike",
  "Boarding",
  "Seizure",
  "Mine",
  "Hijack",
  "GPS jamming",
] as const;

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const seed = [
  [4, 2, 1, 0, 1, 3],
  [6, 3, 0, 1, 0, 4],
  [9, 2, 1, 0, 1, 6],
  [7, 4, 2, 1, 0, 8],
  [11, 3, 1, 0, 2, 9],
  [8, 2, 2, 1, 1, 12],
];
const incidents = months.flatMap((m, mi) =>
  incidentTypes.map((type, ti) => ({ month: m, type, count: seed[mi][ti] })),
);

const chokepoints = [
  "Bab el-Mandeb",
  "Suez Canal",
  "Cape of Good Hope",
  "Strait of Hormuz",
  "Malacca",
  "Gibraltar",
];
const multiples = chokepoints.flatMap((cp, ci) =>
  weeks.map((w) => {
    const base = [70, 62, 38, 88, 210, 300][ci];
    const drift = ci === 0 ? (w > 45 ? -(w - 45) * 2.2 : 0) : 0;
    const bump = ci === 2 ? (w > 45 ? (w - 45) * 1.6 : 0) : 0;
    const noise = Math.sin(w * (ci + 2)) * base * 0.05;
    return { cp, week: w, value: Math.max(Math.round(base + drift + bump + noise), 5) };
  }),
);

/* ---- rendering ---- */

function Legend({ items }: { items: Array<{ label: string; swatch: string }> }) {
  return (
    <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5 text-xs text-ink-2">
          <span className="inline-block size-[8px]" style={{ background: i.swatch }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

// Draw-on entrance: stroked paths draw themselves, bars grow from the
// baseline, labels fade in. Editorial meaning: the data arrives, layer
// by layer, like a plot being traced in the watch room.
function animateChart(root: HTMLElement) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const ease = "cubic-bezier(0.16, 1, 0.3, 1)";

  root.querySelectorAll<SVGPathElement>("path").forEach((p) => {
    if (!p.getAttribute("stroke") || p.getAttribute("fill") !== "none") return;
    const len = p.getTotalLength?.();
    if (!len || len < 10) return;
    p.style.strokeDasharray = `${len}`;
    p.animate(
      [{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
      { duration: 1400, easing: ease, fill: "backwards" },
    ).finished.then(() => (p.style.strokeDasharray = ""));
  });

  const rects = [...root.querySelectorAll<SVGRectElement>("rect")];
  rects.forEach((r) => {
    r.style.transformBox = "fill-box";
    r.style.transformOrigin = "center bottom";
    const x = Number(r.getAttribute("x") ?? 0);
    r.animate([{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], {
      duration: 700,
      delay: Math.min(x * 0.9, 500),
      easing: ease,
      fill: "backwards",
    });
  });

  root.querySelectorAll<SVGTextElement>("text").forEach((t) => {
    t.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 600,
      delay: 500,
      easing: ease,
      fill: "backwards",
    });
  });
}

function useChart(render: (t: ReturnType<typeof readTheme>) => (SVGSVGElement | HTMLElement) | null) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const draw = () => {
      if (!ref.current) return;
      const el = render(readTheme());
      ref.current.replaceChildren(el ?? "");
      animateChart(ref.current);
    };
    draw();
    const stop = onThemeChange(draw);
    return () => {
      stop();
      ref.current?.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ref;
}

export function HeroLineChart() {
  const ref = useChart((t) =>
    Plot.plot({
      ...plotDefaults(t),
      height: 300,
      marginLeft: 34,
      marginRight: 44,
      y: { tickSize: 0, grid: true, gridStroke: t.grid, label: null },
      x: { tickSize: 0, label: null, ticks: [1, 13, 26, 39, 52], tickFormat: (w: number) => `W${w}` },
      marks: [
        Plot.lineY(
          transits.filter((d) => d.series === "2023 baseline"),
          { x: "week", y: "value", stroke: t.context, strokeWidth: 1.5, curve: "basis" },
        ),
        Plot.lineY(
          transits.filter((d) => d.series === "2024"),
          {
            x: "week",
            y: "value",
            stroke: t.hero,
            strokeWidth: 2,
            curve: "basis",
            tip: true,
          },
        ),
        Plot.ruleX([46], { stroke: t.ink3, strokeDasharray: "2,4" }),
        Plot.text([{ week: 45.2, value: 96 }], {
          x: "week",
          y: "value",
          text: () => "Attacks on shipping begin",
          textAnchor: "end",
          fill: t.ink2,
          fontSize: 11,
        }),
        Plot.text([{ week: 40, value: 60 }], {
          x: "week",
          y: "value",
          text: () => "2023 baseline",
          textAnchor: "end",
          fill: t.ink3,
          fontSize: 11,
        }),
        Plot.text([{ week: 52, value: 30 }], {
          x: "week",
          y: "value",
          text: () => "2024",
          textAnchor: "start",
          dx: 4,
          fill: t.hero,
          fontSize: 11,
          fontWeight: 600,
        }),
      ],
    }),
  );
  return (
    <div>
      <Legend
        items={[
          { label: "2024", swatch: "var(--viz-hero)" },
          { label: "2023 baseline", swatch: "var(--viz-context)" },
        ]}
      />
      <div ref={ref} />
    </div>
  );
}

export function StackedBarChart() {
  const ref = useChart((t) =>
    Plot.plot({
      ...plotDefaults(t),
      height: 300,
      marginLeft: 30,
      color: { domain: [...incidentTypes], range: t.series },
      y: { tickSize: 0, grid: true, gridStroke: t.grid, label: null },
      x: { tickSize: 0, label: null, domain: months, padding: 0.25 },
      marks: [
        Plot.barY(incidents, {
          x: "month",
          y: "count",
          fill: "type",
          insetTop: 1,
          insetBottom: 1,
          tip: true,
        }),
      ],
    }),
  );
  return (
    <div>
      <Legend
        items={incidentTypes.map((label, i) => ({
          label,
          swatch: `var(--viz-${i + 1})`,
        }))}
      />
      <div ref={ref} />
    </div>
  );
}

export function SmallMultiples() {
  const ref = useChart((t) =>
    Plot.plot({
      ...plotDefaults(t),
      height: 430,
      marginLeft: 38,
      marginRight: 150,
      x: { tickSize: 0, label: null, ticks: [] },
      y: {
        tickSize: 0,
        grid: true,
        gridStroke: t.grid,
        label: null,
        ticks: [0.5, 1],
        tickFormat: (d: number) => String(Math.round(d * 100)),
      },
      fy: { label: null },
      facet: { data: multiples, y: "cp" },
      marks: [
        Plot.ruleY([1], { stroke: t.grid }),
        Plot.lineY(
          multiples,
          Plot.normalizeY("first", {
            x: "week",
            y: "value",
            stroke: t.hero,
            strokeWidth: 1.5,
            curve: "basis",
            tip: true,
          }),
        ),
        Plot.frame({ stroke: t.grid }),
      ],
    }),
  );
  return <div ref={ref} className="[&_svg]:w-full" />;
}

export default function VizSamples() {
  return (
    <div className="grid gap-12">
      <HeroLineChart />
    </div>
  );
}
