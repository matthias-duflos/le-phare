// One chokepoint's weekly transit calls against its 2024-25 baseline,
// from IMF PortWatch aggregates (bundled by scripts/fetch-portwatch.mjs).
import { useEffect, useRef } from "react";
import * as Plot from "@observablehq/plot";
import { readTheme, plotDefaults, onThemeChange } from "../../lib/viz";
import weekly from "../../data/transits-weekly.json";

const wk = (w: string) => w.slice(5);

export default function StraitChart({ slug }: { slug: string }) {
  const cp = (weekly.chokepoints as any)[slug];
  const rows = cp.weekly as { w: string; t: number }[];
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const draw = () => {
      if (!ref.current) return;
      const t = readTheme();
      ref.current.replaceChildren(
        Plot.plot({
          ...plotDefaults(t),
          height: 280,
          marginLeft: 44,
          marginRight: 54,
          y: { tickSize: 0, grid: true, gridStroke: t.grid, label: null, nice: true, domain: [0, Math.max(cp.baseline ?? 0, ...rows.map((r) => r.t)) * 1.1] },
          x: { tickSize: 0, label: null, ticks: rows.filter((_, i) => i % 4 === 0).map((e) => e.w), tickFormat: wk as any, type: "band" },
          marks: [
            ...(cp.baseline
              ? [
                  Plot.ruleY([cp.baseline], { stroke: t.ink3, strokeDasharray: "2,4" }),
                  Plot.text([{ w: rows[Math.min(2, rows.length - 1)].w, t: cp.baseline }], { x: "w", y: "t", text: () => "2024-25 baseline", dy: -8, textAnchor: "start", fill: t.ink3, fontSize: 10 }),
                ]
              : []),
            Plot.areaY(rows, { x: "w", y: "t", fill: t.hero, fillOpacity: 0.1, curve: "basis" }),
            Plot.lineY(rows, { x: "w", y: "t", stroke: t.hero, strokeWidth: 2, curve: "basis", tip: true }),
            Plot.text([rows.at(-1)], { x: "w", y: "t", text: (d: any) => String(d.t), dx: 8, textAnchor: "start", fill: t.hero, fontSize: 12, fontWeight: 600 }),
          ],
        }),
      );
    };
    draw();
    return onThemeChange(draw);
  }, [slug]);
  return <div ref={ref} className="[&_svg]:w-full" />;
}
