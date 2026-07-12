// The weekly brief's real figures, from IMF PortWatch weekly aggregates
// (bundled at build time by scripts/fetch-portwatch.mjs).
import { useEffect, useRef } from "react";
import * as Plot from "@observablehq/plot";
import { readTheme, plotDefaults, onThemeChange } from "../../lib/viz";
import weekly from "../../data/transits-weekly.json";

function useChart(render: (t: ReturnType<typeof readTheme>) => SVGSVGElement | HTMLElement | null) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const draw = () => ref.current?.replaceChildren(render(readTheme()) ?? "");
    draw();
    return onThemeChange(draw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ref;
}

const wk = (w: string) => w.slice(5); // "2026-W27" -> "W27"

export function BabWeeklyChart() {
  const bab = weekly.chokepoints["bab-el-mandeb"].weekly;
  const suez = weekly.chokepoints["suez"].weekly;
  const ref = useChart((t) =>
    Plot.plot({
      ...plotDefaults(t),
      height: 260,
      marginLeft: 40,
      marginRight: 46,
      y: { tickSize: 0, grid: true, gridStroke: t.grid, label: null, nice: true },
      x: { tickSize: 0, label: null, ticks: bab.filter((_, i) => i % 4 === 0).map((e) => e.w), tickFormat: wk as any, type: "band" },
      marks: [
        Plot.lineY(suez, { x: "w", y: "t", stroke: t.context, strokeWidth: 1.5, curve: "basis" }),
        Plot.lineY(bab, { x: "w", y: "t", stroke: t.hero, strokeWidth: 2, curve: "basis", tip: true }),
        Plot.text([suez.at(-1)], { x: "w", y: "t", text: () => "Suez", dx: 6, textAnchor: "start", fill: t.ink3, fontSize: 11 }),
        Plot.text([bab.at(-1)], { x: "w", y: "t", text: () => "Bab el-M.", dx: 6, textAnchor: "start", fill: t.hero, fontSize: 11, fontWeight: 600 }),
      ],
    }),
  );
  return <div ref={ref} className="[&_svg]:w-full" />;
}

export function ReroutingChart() {
  const rows = weekly.rerouting.filter((r) => r.idx != null);
  const ref = useChart((t) =>
    Plot.plot({
      ...plotDefaults(t),
      height: 220,
      marginLeft: 40,
      y: { tickSize: 0, grid: true, gridStroke: t.grid, label: null, domain: [0, Math.max(...rows.map((r) => r.idx!)) * 1.15] },
      x: { tickSize: 0, label: null, ticks: rows.filter((_, i) => i % 4 === 0).map((e) => e.w), tickFormat: wk as any, type: "band" },
      marks: [
        Plot.ruleY([1], { stroke: t.ink3, strokeDasharray: "2,4" }),
        Plot.areaY(rows, { x: "w", y: "idx", fill: t.hero, fillOpacity: 0.14, curve: "basis" }),
        Plot.lineY(rows, { x: "w", y: "idx", stroke: t.hero, strokeWidth: 2, curve: "basis", tip: true }),
        Plot.text([{ w: rows[Math.floor(rows.length / 2)].w, idx: 1 }], { x: "w", y: "idx", text: () => "parity", dy: -8, fill: t.ink3, fontSize: 10 }),
      ],
    }),
  );
  return <div ref={ref} className="[&_svg]:w-full" />;
}

export const WEEKLY_META = {
  updated: weekly.updated,
  bab: weekly.chokepoints["bab-el-mandeb"].last,
  reroutingNow: weekly.rerouting.at(-1)?.idx,
};
