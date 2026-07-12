// The data lab: build your own chart from the observatory's datasets.
// Currently wired to IMF PortWatch daily chokepoint transits (live-updated
// weekly). Every chart follows the house dataviz theme and can be exported
// as PNG or CSV, with a ready-made citation.
import { useEffect, useMemo, useRef, useState } from "react";
import * as Plot from "@observablehq/plot";
import { readTheme, plotDefaults, onThemeChange } from "../../lib/viz";

type PW = {
  updated: string;
  columns: string[];
  chokepoints: Record<string, { name: string; series: [string, number, number, number, number, number, number][] }>;
};

const METRICS = [
  { id: 1, label: "All transits" },
  { id: 2, label: "Tankers" },
  { id: 3, label: "Container ships" },
  { id: 4, label: "Cargo" },
  { id: 5, label: "Dry bulk" },
  { id: 6, label: "Capacity (dwt)" },
];
const TRANSFORMS = [
  { id: "7d", label: "7-day average" },
  { id: "raw", label: "Daily raw" },
  { id: "weekly", label: "Weekly sum" },
  { id: "index", label: "Index (start = 100)" },
];
const KINDS = [
  { id: "line", label: "Lines" },
  { id: "area", label: "Areas" },
  { id: "multiples", label: "Small multiples" },
];
const DEFAULT_SEL = ["bab-el-mandeb", "suez", "good-hope"];

export default function DataLab() {
  const [pw, setPw] = useState<PW | null>(null);
  const [sel, setSel] = useState<string[]>(DEFAULT_SEL);
  const [metric, setMetric] = useState(1);
  const [transform, setTransform] = useState("7d");
  const [kind, setKind] = useState("line");
  const [from, setFrom] = useState("2024-01-01");
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/data/portwatch.json").then((r) => r.json()).then(setPw).catch(() => {});
  }, []);

  const rows = useMemo(() => {
    if (!pw) return [];
    const out: { date: Date; name: string; value: number }[] = [];
    for (const slug of sel) {
      const cp = pw.chokepoints[slug];
      if (!cp) continue;
      let series = cp.series.filter((r) => r[0] >= from).map((r) => ({ date: r[0], v: r[metric] as number }));
      if (transform === "7d") {
        series = series.map((r, i, a) => {
          const win = a.slice(Math.max(0, i - 6), i + 1);
          return { date: r.date, v: win.reduce((s, x) => s + x.v, 0) / win.length };
        });
      } else if (transform === "weekly") {
        const byW = new Map<string, number>();
        for (const r of series) {
          const d = new Date(r.date + "T00:00:00Z");
          d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
          const k = d.toISOString().slice(0, 10);
          byW.set(k, (byW.get(k) ?? 0) + r.v);
        }
        series = [...byW.entries()].slice(0, -1).map(([date, v]) => ({ date, v }));
      } else if (transform === "index") {
        const base = series.slice(0, 7).reduce((s, x) => s + x.v, 0) / Math.min(7, series.length) || 1;
        series = series.map((r, i, a) => {
          const win = a.slice(Math.max(0, i - 6), i + 1);
          const avg = win.reduce((s, x) => s + x.v, 0) / win.length;
          return { date: r.date, v: (avg / base) * 100 };
        });
      }
      for (const r of series) out.push({ date: new Date(r.date), name: cp.name, value: r.v });
    }
    return out;
  }, [pw, sel, metric, transform, from]);

  useEffect(() => {
    const draw = () => {
      if (!chartRef.current || !rows.length) return;
      const t = readTheme();
      const names = sel.map((s) => pw!.chokepoints[s]?.name).filter(Boolean);
      const common = {
        ...plotDefaults(t),
        height: kind === "multiples" ? Math.max(90 * names.length, 200) : 380,
        marginLeft: 46,
        marginRight: kind === "multiples" ? 130 : 20,
        color: { domain: names, range: t.series },
        y: { tickSize: 0, grid: true, gridStroke: t.grid, label: null, nice: true },
        x: { tickSize: 0, label: null, type: "time" as const },
      };
      let marks: any[];
      if (kind === "area") {
        marks = names.map((n, i) => [
          Plot.areaY(rows.filter((r) => r.name === n), { x: "date", y: "value", fill: t.series[i], fillOpacity: 0.18, curve: "basis" }),
          Plot.lineY(rows.filter((r) => r.name === n), { x: "date", y: "value", stroke: t.series[i], strokeWidth: 1.6, curve: "basis", tip: true }),
        ]).flat();
      } else {
        marks = [
          Plot.lineY(rows, { x: "date", y: "value", stroke: "name", strokeWidth: 1.7, curve: "basis", tip: true }),
        ];
      }
      const el = Plot.plot(
        kind === "multiples"
          ? { ...common, fy: { label: null }, facet: { data: rows, y: "name" }, marks: [...marks, Plot.frame({ stroke: t.grid })] }
          : { ...common, marks },
      );
      chartRef.current.replaceChildren(el);
    };
    draw();
    return onThemeChange(draw);
  }, [rows, kind, sel, pw]);

  const title = `${METRICS.find((m) => m.id === metric)!.label} · ${sel.length} chokepoint${sel.length > 1 ? "s" : ""} · ${TRANSFORMS.find((t) => t.id === transform)!.label.toLowerCase()}`;

  const downloadPNG = () => {
    const svg = chartRef.current?.querySelector("svg");
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = svg.clientWidth * 2;
      c.height = svg.clientHeight * 2;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--bg-0");
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0);
      const a = document.createElement("a");
      a.download = "le-phare-chart.png";
      a.href = c.toDataURL("image/png");
      a.click();
    };
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(xml)));
  };

  const downloadCSV = () => {
    const csv = ["date,chokepoint,value", ...rows.map((r) => `${r.date.toISOString().slice(0, 10)},"${r.name}",${Math.round(r.value * 100) / 100}`)].join("\n");
    const a = document.createElement("a");
    a.download = "le-phare-data.csv";
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.click();
  };

  if (!pw) return <p className="t-meta py-10">loading PortWatch dataset…</p>;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-2">
        {Object.entries(pw.chokepoints).map(([slug, cp]) => (
          <button
            key={slug}
            aria-pressed={sel.includes(slug)}
            onClick={() =>
              setSel((s) => (s.includes(slug) ? (s.length > 1 ? s.filter((x) => x !== slug) : s) : s.length < 6 ? [...s, slug] : s))
            }
            className={`t-caps cursor-pointer border rounded-r1 px-2.5 py-1.5 transition-all duration-150 ${
              sel.includes(slug) ? "border-[color:var(--accent)] !text-accent-text" : "border-line-2 !text-ink-3"
            }`}
          >
            {cp.name}
          </button>
        ))}
        <span className="t-meta ml-2">max 6 · colours follow selection order</span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {[
          { v: metric, set: (x: string) => setMetric(Number(x)), opts: METRICS.map((m) => [m.id, m.label]) },
          { v: transform, set: setTransform, opts: TRANSFORMS.map((t) => [t.id, t.label]) },
          { v: kind, set: setKind, opts: KINDS.map((k) => [k.id, k.label]) },
        ].map((c, i) => (
          <select
            key={i}
            value={c.v as any}
            onChange={(e) => (c.set as any)(e.target.value)}
            className="cursor-pointer border border-line-2 bg-bg-0 px-2.5 py-1.5 text-sm text-ink-2 rounded-r1"
          >
            {c.opts.map(([v, l]) => (
              <option key={String(v)} value={String(v)}>{l}</option>
            ))}
          </select>
        ))}
        <label className="t-meta flex items-center gap-2">
          from
          <input
            type="date"
            value={from}
            min="2024-01-01"
            max={pw.updated}
            onChange={(e) => setFrom(e.target.value)}
            className="border border-line-2 bg-bg-0 px-2 py-1.5 text-sm text-ink-2 rounded-r1"
          />
        </label>
        <span className="t-meta ml-auto">updated {pw.updated}</span>
      </div>

      <figure className="border-t border-line-2 pt-4">
        <figcaption>
          <p className="t-serif text-xl">{title}</p>
          <p className="mt-1 text-sm text-ink-3">Vessel transit calls per day. IMF PortWatch, satellite AIS.</p>
        </figcaption>
        <div ref={chartRef} className="mt-4 [&_svg]:w-full" />
        <p className="t-meta mt-3">Source: IMF PortWatch · Graphic: Le Phare</p>
      </figure>

      <div className="flex flex-wrap gap-4">
        <button onClick={downloadPNG} className="btn-beam t-caps cursor-pointer bg-accent !text-accent-ink rounded-r1 px-4 py-2">Download PNG</button>
        <button onClick={downloadCSV} className="t-caps cursor-pointer border border-line-2 rounded-r1 px-4 py-2 !text-ink-2 transition-colors duration-150 hover:border-[color:var(--accent)] hover:!text-accent-text">Download CSV</button>
        <p className="t-meta self-center select-all">
          Cite: Le Phare, from IMF PortWatch daily transit calls, retrieved {pw.updated}.
        </p>
      </div>
    </div>
  );
}
