// The incident database explorer: clustered map (Abyss style), filters,
// sortable table and monthly trend, all driven by the same filtered set.
// Sample data until the pipeline ships; the page says so plainly.
import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import * as Plot from "@observablehq/plot";
import { readTheme, plotDefaults, onThemeChange } from "../../lib/viz";
import incidentsRaw from "../../data/incidents.json";

type Incident = {
  id: string;
  date: string;
  type: string;
  zone: string;
  lat: number;
  lon: number;
  summary: string;
  vessel?: string | null;
  hostility?: string | null;
  source: { name: string; url: string };
};

const CURATED = incidentsRaw as Incident[];

export const TYPE_LABELS: Record<string, string> = {
  "drone-strike": "Missile / drone strike",
  boarding: "Boarding / robbery",
  seizure: "Seizure",
  mine: "Mine",
  hijack: "Hijack",
  "gps-jamming": "GPS jamming",
};
const TYPE_ORDER = Object.keys(TYPE_LABELS);
const typeVar = (t: string) => `var(--viz-${TYPE_ORDER.indexOf(t) + 1})`;

const YEARS = [
  { id: "2026", label: "2026", note: "curated · sample" },
  { id: "2024", label: "2024", note: "NGA ASAM" },
  { id: "2023", label: "2023", note: "NGA ASAM" },
  { id: "2022", label: "2022", note: "NGA ASAM" },
  { id: "all", label: "All", note: "2022 → 2026" },
];

const fmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "2-digit" });

export default function IncidentExplorer() {
  const [year, setYear] = useState("2026");
  const [asam, setAsam] = useState<Incident[] | null>(null);
  const [types, setTypes] = useState<Set<string>>(new Set(TYPE_ORDER));
  const [zone, setZone] = useState("");
  const [sort, setSort] = useState<{ key: "date" | "type" | "zone"; dir: 1 | -1 }>({ key: "date", dir: -1 });

  // the real archive is heavy (677 events), fetched once outside the bundle
  useEffect(() => {
    fetch("/data/incidents-asam.json")
      .then((r) => r.json())
      .then(setAsam)
      .catch(() => setAsam([]));
  }, []);

  const data = useMemo(() => [...CURATED, ...(asam ?? [])], [asam]);
  const loading = asam === null && year !== "2026";
  const zones = useMemo(
    () => [...new Set(data.filter((i) => year === "all" || i.date.startsWith(year)).map((i) => i.zone))].sort(),
    [data, year],
  );

  const filtered = useMemo(
    () =>
      data.filter(
        (i) =>
          (year === "all" || i.date.startsWith(year)) &&
          types.has(i.type) &&
          (!zone || i.zone === zone),
      ),
    [data, types, year, zone],
  );

  const sorted = useMemo(
    () =>
      [...filtered].sort((a, b) => {
        const va = a[sort.key];
        const vb = b[sort.key];
        return va < vb ? -sort.dir : va > vb ? sort.dir : 0;
      }),
    [filtered, sort],
  );

  /* ---------- map ---------- */
  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);

  const geojson = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: filtered.map((i) => ({
        type: "Feature" as const,
        properties: { ...i, color: typeVar(i.type) },
        geometry: { type: "Point" as const, coordinates: [i.lon, i.lat] },
      })),
    }),
    [filtered],
  );

  useEffect(() => {
    if (!mapDiv.current) return;
    const map = new maplibregl.Map({
      container: mapDiv.current,
      style: "/map/abyss.json",
      center: [38, 17],
      zoom: 2.4,
      attributionControl: { compact: true },
      cooperativeGestures: true,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("incidents", { type: "geojson", data: geojson, cluster: true, clusterRadius: 42 });
      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "incidents",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "rgba(242,185,80,0.22)",
          "circle-stroke-color": "#F2B950",
          "circle-stroke-width": 1.5,
          "circle-radius": ["step", ["get", "point_count"], 14, 5, 20, 10, 26],
        },
      });
      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "incidents",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 12,
          "text-font": ["Noto Sans Regular"],
        },
        paint: { "text-color": "#E8EDF2" },
      });
      map.addLayer({
        id: "points",
        type: "circle",
        source: "incidents",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": 6,
          "circle-color": [
            "match",
            ["get", "type"],
            "drone-strike", "#C98500",
            "boarding", "#2FA189",
            "seizure", "#8B7FE8",
            "mine", "#C46383",
            "hijack", "#4E8FD0",
            "gps-jamming", "#C75A38",
            "#F2B950",
          ],
          "circle-stroke-color": "rgba(232,237,242,0.6)",
          "circle-stroke-width": 1,
        },
      });

      map.on("click", "clusters", async (e) => {
        const f = map.queryRenderedFeatures(e.point, { layers: ["clusters"] })[0];
        const src = map.getSource("incidents") as maplibregl.GeoJSONSource;
        const z = await src.getClusterExpansionZoom(f.properties!.cluster_id);
        map.easeTo({ center: (f.geometry as any).coordinates, zoom: z + 0.3 });
      });
      map.on("click", "points", (e) => {
        const p = e.features![0].properties as any;
        showPopup(p, (e.features![0].geometry as any).coordinates);
      });
      for (const l of ["clusters", "points"]) {
        map.on("mouseenter", l, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", l, () => (map.getCanvas().style.cursor = ""));
      }
    });

    return () => {
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep source in sync with filters
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => (map.getSource("incidents") as maplibregl.GeoJSONSource | undefined)?.setData(geojson as any);
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [geojson]);

  const showPopup = (p: Incident, coords: [number, number]) => {
    popupRef.current?.remove();
    const source = typeof p.source === "string" ? JSON.parse(p.source as any) : p.source;
    popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: "320px" })
      .setLngLat(coords)
      .setHTML(
        `<div style="font-family:var(--font-sans);color:var(--ink);background:var(--bg-1);padding:14px 16px;border:1px solid var(--line-2);max-height:300px;overflow-y:auto">
          <p style="font-family:var(--font-mono);font-size:11px;color:var(--ink-3)">${p.id} · ${p.date} · ${p.zone}</p>
          <p style="font-size:11px;text-transform:uppercase;letter-spacing:0.09em;margin-top:6px;color:${typeVar(p.type)}">${TYPE_LABELS[p.type]}</p>
          ${p.vessel ? `<p style="font-size:12.5px;margin-top:7px;color:var(--ink-2)"><strong style="color:var(--ink)">Vessel:</strong> ${p.vessel}</p>` : ""}
          ${p.hostility ? `<p style="font-size:12.5px;margin-top:3px;color:var(--ink-2)"><strong style="color:var(--ink)">Hostility:</strong> ${p.hostility}</p>` : ""}
          <p style="font-size:13.5px;line-height:1.55;margin-top:8px">${p.summary}</p>
          <p style="font-size:11px;margin-top:10px"><a href="${source.url}" target="_blank" rel="noopener" style="color:var(--accent-text)">Source: ${source.name} ↗</a></p>
        </div>`,
      )
      .addTo(mapRef.current!);
  };

  const focusIncident = (i: Incident) => {
    mapRef.current?.easeTo({ center: [i.lon, i.lat], zoom: 5.5, duration: 900 });
    showPopup(i, [i.lon, i.lat]);
    document.getElementById("incident-map")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  /* ---------- monthly trend ---------- */
  const chartRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const draw = () => {
      if (!chartRef.current) return;
      const t = readTheme();
      const monthly = filtered.map((i) => ({ month: i.date.slice(0, 7), type: TYPE_LABELS[i.type] }));
      const months = [...new Set(monthly.map((m) => m.month))].sort();
      const every = Math.max(1, Math.ceil(months.length / 8));
      const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const fmtMonth = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
      const el = Plot.plot({
        ...plotDefaults(t),
        height: 220,
        marginLeft: 28,
        color: { domain: TYPE_ORDER.map((k) => TYPE_LABELS[k]), range: t.series },
        y: { tickSize: 0, grid: true, gridStroke: t.grid, label: null, interval: 1 },
        x: {
          tickSize: 0,
          label: null,
          type: "band",
          domain: months,
          ticks: months.filter((_, i) => i % every === 0),
          tickFormat: fmtMonth as any,
        },
        marks: [
          Plot.barY(monthly, Plot.groupX({ y: "count" }, { x: "month", fill: "type", insetTop: 1, insetBottom: 1, tip: true })),
        ],
      });
      chartRef.current.replaceChildren(el);
    };
    draw();
    return onThemeChange(draw);
  }, [filtered]);

  const toggleType = (t: string) =>
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t) && next.size === 1) return new Set(TYPE_ORDER); // never empty
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });

  const th = (key: "date" | "type" | "zone", label: string) => (
    <th>
      <button
        className="t-caps cursor-pointer transition-colors duration-150 hover:!text-accent-text"
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }))}
      >
        {label} {sort.key === key ? (sort.dir === 1 ? "↑" : "↓") : ""}
      </button>
    </th>
  );

  return (
    <div className="grid gap-10">
      {/* filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {YEARS.map((y) => (
            <button
              key={y.id}
              aria-pressed={year === y.id}
              onClick={() => { setYear(y.id); setZone(""); }}
              title={y.note}
              className={`t-caps cursor-pointer border rounded-r1 px-3 py-1.5 transition-all duration-150 ${
                year === y.id ? "border-[color:var(--accent)] !text-accent-text" : "border-line-2 !text-ink-3"
              }`}
            >
              {y.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {TYPE_ORDER.map((t) => (
            <button
              key={t}
              onClick={() => toggleType(t)}
              aria-pressed={types.has(t)}
              className={`t-caps inline-flex cursor-pointer items-center gap-1.5 border rounded-r1 px-2.5 py-1.5 transition-all duration-150 ${
                types.has(t) ? "border-line-2 !text-ink-2" : "border-line !text-ink-3 opacity-45"
              }`}
            >
              <span className="inline-block size-[7px]" style={{ background: typeVar(t) }} />
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        <select
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          className="cursor-pointer border border-line-2 bg-bg-0 px-2.5 py-1.5 text-sm text-ink-2 rounded-r1"
        >
          <option value="">All zones</option>
          {zones.map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>
        <p className="t-meta ml-auto" aria-live="polite">
          {loading
            ? "loading archive…"
            : `${filtered.length} incident${filtered.length === 1 ? "" : "s"} · ${
                year === "2026" ? "curated from public reporting · sample" : year === "all" ? "ASAM + curated" : "NGA ASAM, public domain"
              }`}
        </p>
      </div>

      {/* map */}
      <div
        id="incident-map"
        ref={mapDiv}
        className="h-[480px] w-full border border-line-2 [&_.maplibregl-popup-content]:!bg-transparent [&_.maplibregl-popup-content]:!p-0 [&_.maplibregl-popup-content]:!shadow-none [&_.maplibregl-popup-tip]:!border-t-[color:var(--bg-1)] [&_.maplibregl-ctrl-attrib]:!bg-bg-1 [&_.maplibregl-ctrl-attrib]:!text-ink-3 [&_.maplibregl-ctrl-attrib]:!text-[10px] [&_.maplibregl-popup-close-button]:!text-ink-2 [&_.maplibregl-popup-close-button]:!text-lg [&_.maplibregl-popup-close-button]:!px-2"
      />

      {/* trend + table */}
      <div className="grid gap-12 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <p className="t-serif text-xl">Monthly trend</p>
          <p className="mt-1 text-sm text-ink-3">
            Incidents per month by type ·{" "}
            {year === "2026" ? "curated 2026, sample" : year === "all" ? "ASAM archive + curated 2026" : `NGA ASAM archive, ${year}`}
          </p>
          <div ref={chartRef} className="mt-4" />
        </div>
        <div className="overflow-x-auto lg:col-span-7">
          <table className="data-table">
            <thead>
              <tr>
                {th("date", "Date")}
                {th("type", "Type")}
                {th("zone", "Zone")}
                <th>Vessel</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 60).map((i) => (
                <tr key={i.id} onClick={() => focusIncident(i)} className="cursor-pointer">
                  <td className="whitespace-nowrap font-mono text-[13px]">{fmt.format(new Date(i.date))}</td>
                  <td className="whitespace-nowrap">
                    <span className="mr-1.5 inline-block size-[7px]" style={{ background: typeVar(i.type) }} />
                    {TYPE_LABELS[i.type]}
                  </td>
                  <td className="whitespace-nowrap">{i.zone}</td>
                  <td className="min-w-[140px] max-w-[220px] text-[12.5px] leading-snug">{i.vessel ?? "—"}</td>
                  <td className="min-w-[260px] max-w-[420px] text-[13px] leading-relaxed">
                    {i.summary.length > 220 ? i.summary.slice(0, 220) + "…" : i.summary}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {sorted.length > 60 && (
            <p className="t-meta mt-3">
              showing the 60 most recent of {sorted.length} · refine with the filters or the map
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
