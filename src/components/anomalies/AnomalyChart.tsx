// Weekly anomaly counts by heuristic, on the shared viz theme.
import { useEffect, useRef } from "react";
import * as Plot from "@observablehq/plot";
import { readTheme, plotDefaults, onThemeChange } from "../../lib/viz";

type Row = { week: string; heuristic: string; count: number };

export default function AnomalyChart({ rows }: { rows: Row[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const draw = () => {
      if (!ref.current) return;
      const t = readTheme();
      const heuristics = [...new Set(rows.map((r) => r.heuristic))];
      ref.current.replaceChildren(
        Plot.plot({
          ...plotDefaults(t),
          height: 260,
          marginLeft: 34,
          color: { domain: heuristics, range: t.series },
          y: { tickSize: 0, grid: true, gridStroke: t.grid, label: null },
          x: { tickSize: 0, label: null },
          marks: [
            Plot.barY(rows, { x: "week", y: "count", fill: "heuristic", insetTop: 1, insetBottom: 1, tip: true }),
          ],
        }),
      );
    };
    draw();
    return onThemeChange(draw);
  }, [rows]);
  return <div ref={ref} className="[&_svg]:w-full" />;
}
