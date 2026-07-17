// Figures for intelligence notes — one per subject, all from the
// observatory's own PortWatch weekly aggregates. Annotated: a note's chart
// should carry its argument without the caption.
import { useEffect, useRef } from "react";
import * as Plot from "@observablehq/plot";
import { readTheme, plotDefaults, onThemeChange } from "../../lib/viz";
import weekly from "../../data/transits-weekly.json";

export { ReroutingChart } from "./BriefCharts";

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

const wk = (w: string) => w.slice(5);

/** Hormuz weekly transits against baseline, ceasefire annotated. */
export function HormuzChart() {
  const cp = (weekly.chokepoints as any)["hormuz"];
  const rows = cp.weekly as { w: string; t: number }[];
  const baseline = cp.baseline as number;
  const ref = useChart((t) =>
    Plot.plot({
      ...plotDefaults(t),
      height: 280,
      marginLeft: 40,
      marginRight: 10,
      y: { tickSize: 0, grid: true, gridStroke: t.grid, label: null, domain: [0, baseline * 1.12] },
      x: { tickSize: 0, label: null, ticks: rows.filter((_, i) => i % 4 === 0).map((e) => e.w), tickFormat: wk as any, type: "band" },
      marks: [
        Plot.ruleY([baseline], { stroke: t.ink3, strokeDasharray: "2,4" }),
        Plot.text([{ w: rows[2].w, t: baseline }], { x: "w", y: "t", text: () => `2024-25 baseline ~${baseline}`, dy: -8, textAnchor: "start", fill: t.ink3, fontSize: 10.5 }),
        Plot.areaY(rows, { x: "w", y: "t", fill: t.risk, fillOpacity: 0.1, curve: "basis" }),
        Plot.lineY(rows, { x: "w", y: "t", stroke: t.risk, strokeWidth: 2, curve: "basis", tip: true }),
        Plot.ruleX(["2026-W25"], { stroke: t.ink3, strokeDasharray: "2,3" }),
        Plot.text([{ w: "2026-W25", t: baseline * 0.72 }], { x: "w", y: "t", text: () => "17 Jun\nceasefire", dx: 6, textAnchor: "start", fill: t.ink3, fontSize: 10.5, lineHeight: 1.25 }),
        Plot.text([rows.at(-1)], { x: "w", y: "t", text: (d: any) => String(d.t), dy: -10, fill: t.risk, fontSize: 12, fontWeight: 600 }),
      ],
    }),
  );
  return <div ref={ref} className="[&_svg]:w-full" />;
}

/** Taiwan Strait weekly transits, the typhoon week annotated. */
export function TaiwanChart() {
  const cp = (weekly.chokepoints as any)["taiwan-strait"];
  const rows = cp.weekly as { w: string; t: number }[];
  const last = rows.at(-1)!;
  const ref = useChart((t) =>
    Plot.plot({
      ...plotDefaults(t),
      height: 240,
      marginLeft: 44,
      marginRight: 10,
      y: { tickSize: 0, grid: true, gridStroke: t.grid, label: null, nice: true },
      x: { tickSize: 0, label: null, ticks: rows.filter((_, i) => i % 4 === 0).map((e) => e.w), tickFormat: wk as any, type: "band" },
      marks: [
        Plot.lineY(rows, { x: "w", y: "t", stroke: t.hero, strokeWidth: 2, curve: "basis", tip: true }),
        Plot.dot([last], { x: "w", y: "t", fill: t.hero, r: 3.5 }),
        Plot.text([last], { x: "w", y: "t", text: (d: any) => `${d.t}\nBavi week`, dy: 18, dx: -4, textAnchor: "end", fill: t.hero, fontSize: 10.5, fontWeight: 600, lineHeight: 1.25 }),
      ],
    }),
  );
  return <div ref={ref} className="[&_svg]:w-full" />;
}
