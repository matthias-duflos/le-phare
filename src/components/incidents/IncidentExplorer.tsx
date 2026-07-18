// The incident database explorer: clustered map (Abyss style), filters,
// sortable table and monthly trend, all driven by the same filtered set.
// Sample data until the pipeline ships; the page says so plainly.
import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import * as Plot from "@observablehq/plot";
import { readTheme, plotDefaults, onThemeChange, exportPlotPNG } from "../../lib/viz";
import { getWireArticles, wirePin, wireTime, type WirePin } from "../../lib/wire";
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
  origin?: string; // "recaap" | "imb" — auto-ingested feeds
};

type Warning = { ref: string; text: string; issued?: string | null; points: [number, number][] };

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
  { id: "2026", label: "2026", note: "auto-ingested (ReCAAP, IMB) + brief" },
  { id: "2025", label: "2025", note: "auto-ingested (ReCAAP, IMB) + brief" },
  { id: "2024", label: "2024", note: "ASAM to June · auto-ingested after" },
  { id: "2023", label: "2023", note: "NGA ASAM" },
  { id: "2022", label: "2022", note: "NGA ASAM" },
  { id: "all", label: "All", note: "2022 → 2026" },
];

const fmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "2-digit" });

export default function IncidentExplorer() {
  const [year, setYear] = useState("2026");
  const [asam, setAsam] = useState<Incident[] | null>(null);
  const [live, setLive] = useState<Incident[] | null>(null);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [showWarn, setShowWarn] = useState(true);
  const [wire, setWire] = useState<WirePin[]>([]);
  const [showWire, setShowWire] = useState(true);
  const [types, setTypes] = useState<Set<string>>(new Set(TYPE_ORDER));
  const [zone, setZone] = useState("");
  const [sort, setSort] = useState<{ key: "date" | "type" | "zone"; dir: 1 | -1 }>({ key: "date", dir: -1 });

  // heavier datasets fetched once outside the bundle:
  // the ASAM archive (677 events), the auto-ingested feed (ReCAAP + IMB,
  // refreshed by cron) and the active official NAVAREA warnings
  useEffect(() => {
    fetch("/data/incidents-asam.json")
      .then((r) => r.json())
      .then(setAsam)
      .catch(() => setAsam([]));
    fetch("/data/incidents-live.json")
      .then((r) => r.json())
      .then((d) => setLive(d.events ?? []))
      .catch(() => setLive([]));
    fetch("/data/navarea.json")
      .then((r) => r.json())
      .then((d) => setWarnings((d.warnings ?? []).filter((w: Warning) => w.points?.length)))
      .catch(() => {});
    // wire pins: news mentions of the last 24 h, geocoded by place keyword,
    // from the 6-h wire snapshot — re-read every 15 min while the page stays
    // open so a long-lived tab picks up the cron's refreshes
    let timer = 0;
    const loadWire = () =>
      getWireArticles().then(({ articles }) => {
        const dayAgo = Date.now() - 24 * 3600000;
        const seen = new Set<string>();
        const pins: WirePin[] = [];
        for (const a of articles) {
          if (wireTime(a.seendate) < dayAgo) continue;
          const k = a.title.toLowerCase().slice(0, 55);
          if (seen.has(k)) continue;
          seen.add(k);
          const p = wirePin(a);
          if (p) pins.push(p);
        }
        setWire(pins);
      });
    loadWire();
    timer = window.setInterval(loadWire, 15 * 60000);
    return () => clearInterval(timer);
  }, []);

  const data = useMemo(() => [...CURATED, ...(live ?? []), ...(asam ?? [])], [asam, live]);
  const loading = (asam === null && year !== "2026") || live === null;
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

      // active official warnings: hollow red diamonds, always "now"
      map.addSource("warnings", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "warning-points",
        type: "circle",
        source: "warnings",
        paint: {
          "circle-radius": 7,
          "circle-color": "rgba(192,57,43,0.15)",
          "circle-stroke-color": "#C0392B",
          "circle-stroke-width": 1.6,
        },
      });
      map.on("click", "warning-points", (e) => {
        const p = e.features![0].properties as any;
        popupRef.current?.remove();
        popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: "320px" })
          .setLngLat((e.features![0].geometry as any).coordinates)
          .setHTML(
            `<div style="font-family:var(--font-sans);color:var(--ink);background:var(--bg-1);padding:14px 16px;border:1px solid var(--line-2);max-height:280px;overflow-y:auto">
              <p style="font-family:var(--font-mono);font-size:11px;color:var(--risk-text)">${p.ref} · ACTIVE OFFICIAL WARNING</p>
              <p style="font-size:12.5px;line-height:1.55;margin-top:8px">${String(p.text).slice(0, 420)}${String(p.text).length > 420 ? "…" : ""}</p>
              <p style="font-size:11px;margin-top:10px;color:var(--ink-3)">NGA MSI broadcast warning · live feed, public domain</p>
            </div>`,
          )
          .addTo(map);
      });
      map.on("mouseenter", "warning-points", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "warning-points", () => (map.getCanvas().style.cursor = ""));

      // wire pins: last-24h news mentions, color by severity, pulsing in
      map.addSource("wire", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "wire-pins",
        type: "circle",
        source: "wire",
        paint: {
          "circle-radius": ["match", ["get", "severity"], "severe", 5.5, "incident", 4.5, 3.5],
          "circle-color": ["match", ["get", "severity"], "severe", "#C0392B", "incident", "#F2B950", "#5E7C93"],
          "circle-opacity": 0.9,
          "circle-stroke-color": "rgba(232,237,242,0.5)",
          "circle-stroke-width": 1,
        },
      });
      map.on("click", "wire-pins", (e) => {
        const p = e.features![0].properties as any;
        popupRef.current?.remove();
        popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: "320px" })
          .setLngLat((e.features![0].geometry as any).coordinates)
          .setHTML(
            `<div style="font-family:var(--font-sans);color:var(--ink);background:var(--bg-1);padding:14px 16px;border:1px solid var(--line-2)">
              <p style="font-family:var(--font-mono);font-size:11px;color:var(--ink-3)">${p.when} · ${p.domain} · wire</p>
              <p style="font-size:13.5px;line-height:1.5;margin-top:7px">${p.title}</p>
              <p style="font-size:11px;margin-top:9px"><a href="${p.url}" target="_blank" rel="noopener" style="color:var(--accent-text)">Read the article ↗</a></p>
              <p style="font-size:11px;margin-top:7px;color:var(--ink-3)">news mention, unverified · position approximate (keyword geocode) · fades after 24 h</p>
            </div>`,
          )
          .addTo(map);
      });
      map.on("mouseenter", "wire-pins", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "wire-pins", () => (map.getCanvas().style.cursor = ""));

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

  // warnings layer follows its toggle
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const geo = {
      type: "FeatureCollection" as const,
      features: showWarn
        ? warnings.flatMap((w) =>
            w.points.map(([lat, lon]) => ({
              type: "Feature" as const,
              properties: { ref: w.ref, text: w.text },
              geometry: { type: "Point" as const, coordinates: [lon, lat] },
            })),
          )
        : [],
    };
    const apply = () => (map.getSource("warnings") as maplibregl.GeoJSONSource | undefined)?.setData(geo as any);
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [warnings, showWarn]);

  // wire pins follow their toggle and the 15-min refresh
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const fmtWhen = (s: string) => `${s.slice(9, 11)}:${s.slice(11, 13)} UTC`;
    const geo = {
      type: "FeatureCollection" as const,
      features: showWire
        ? wire.map((p) => ({
            type: "Feature" as const,
            properties: { title: p.title, url: p.url, domain: p.domain, severity: p.severity, when: fmtWhen(p.seendate) },
            geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] },
          }))
        : [],
    };
    const apply = () => (map.getSource("wire") as maplibregl.GeoJSONSource | undefined)?.setData(geo as any);
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [wire, showWire]);

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

  /* ---------- charts row ---------- */
  const zoneRef = useRef<HTMLDivElement>(null);
  const typeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const draw = () => {
      const t = readTheme();
      if (zoneRef.current) {
        const byZone = Object.entries(
          filtered.reduce((a: Record<string, number>, i) => ((a[i.zone] = (a[i.zone] ?? 0) + 1), a), {}),
        )
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([zone, n]) => ({ zone, n }));
        zoneRef.current.replaceChildren(
          Plot.plot({
            ...plotDefaults(t),
            height: 220,
            marginLeft: 150,
            x: { tickSize: 0, label: null, grid: true, gridStroke: t.grid },
            y: { tickSize: 0, label: null },
            marks: [
              Plot.barX(byZone, { y: "zone", x: "n", fill: t.hero, insetTop: 1.5, insetBottom: 1.5, sort: { y: "-x" }, tip: true }),
            ],
          }),
        );
      }
      if (typeRef.current) {
        // resolved theme colors (not var() strings) so the PNG export keeps them
        const byType = TYPE_ORDER.map((k) => ({
          type: TYPE_LABELS[k],
          n: filtered.filter((i) => i.type === k).length,
          c: t.series[TYPE_ORDER.indexOf(k)],
        })).filter((d) => d.n > 0);
        typeRef.current.replaceChildren(
          Plot.plot({
            ...plotDefaults(t),
            height: 220,
            marginLeft: 150,
            x: { tickSize: 0, label: null, grid: true, gridStroke: t.grid },
            y: { tickSize: 0, label: null },
            marks: [
              Plot.barX(byType, { y: "type", x: "n", fill: "c", insetTop: 1.5, insetBottom: 1.5, sort: { y: "-x" }, tip: true }),
            ],
          }),
        );
      }
    };
    draw();
    return onThemeChange(draw);
  }, [filtered]);

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

  // PNG filename mirrors the active filters, so the file says what it shows
  const pngName = (chart: string) =>
    `le-phare-incidents-${chart}-${year === "all" ? "2022-2026" : year}${
      zone ? "-" + zone.toLowerCase().replace(/[^a-z0-9]+/g, "-") : ""
    }.png`;

  const toggleType = (t: string) =>
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t) && next.size === 1) return new Set(TYPE_ORDER); // never empty
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });

  const th = (key: "date" | "type" | "zone", label: string) => (
    <button
      key={key}
      className={`t-caps cursor-pointer border rounded-r1 px-2.5 py-1 transition-colors duration-150 hover:!text-accent-text ${sort.key === key ? "border-line-2 !text-ink-2" : "border-transparent !text-ink-3"}`}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }))}
    >
      {label} {sort.key === key ? (sort.dir === 1 ? "↑" : "↓") : ""}
    </button>
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
        <button
          onClick={() => setShowWarn((s) => !s)}
          aria-pressed={showWarn}
          title="Active NAVAREA / HYDRO warnings with a security dimension, live from NGA MSI"
          className={`t-caps inline-flex cursor-pointer items-center gap-1.5 border rounded-r1 px-2.5 py-1.5 transition-all duration-150 ${
            showWarn ? "border-[color:var(--risk)] !text-risk-text" : "border-line !text-ink-3 opacity-45"
          }`}
        >
          <span className="inline-block size-[7px] rounded-full border border-[color:var(--risk)]" />
          warnings now
        </button>
        <button
          onClick={() => setShowWire((s) => !s)}
          aria-pressed={showWire}
          title="News mentions of the last 24 h, geocoded by place keyword — unverified, approximate"
          className={`t-caps inline-flex cursor-pointer items-center gap-1.5 border rounded-r1 px-2.5 py-1.5 transition-all duration-150 ${
            showWire ? "border-line-2 !text-ink-2" : "border-line !text-ink-3 opacity-45"
          }`}
        >
          <span className="inline-block size-[7px] rounded-full" style={{ background: "#5E7C93" }} />
          wire 24h{wire.length ? ` · ${wire.length}` : ""}
        </button>
        <p className="t-meta ml-auto" aria-live="polite">
          {loading
            ? "loading feeds…"
            : `${filtered.length} incident${filtered.length === 1 ? "" : "s"} · ${
                year >= "2025" ? "auto-ingested: ReCAAP + IMB PRC · plus the brief's record" : year === "all" ? "ASAM + auto-ingested + brief" : year === "2024" ? "ASAM to June · auto-ingested after" : "NGA ASAM, public domain"
              }`}
        </p>
      </div>

      {/* map */}
      <div
        id="incident-map"
        ref={mapDiv}
        className="h-[480px] w-full border border-line-2 [&_.maplibregl-popup-content]:!bg-transparent [&_.maplibregl-popup-content]:!p-0 [&_.maplibregl-popup-content]:!shadow-none [&_.maplibregl-popup-tip]:!border-t-[color:var(--bg-1)] [&_.maplibregl-ctrl-attrib]:!bg-bg-1 [&_.maplibregl-ctrl-attrib]:!text-ink-3 [&_.maplibregl-ctrl-attrib]:!text-[10px] [&_.maplibregl-popup-close-button]:!text-ink-2 [&_.maplibregl-popup-close-button]:!text-lg [&_.maplibregl-popup-close-button]:!px-2"
      />
      <p className="t-meta -mt-6">
        live layers: <span className="mr-1 inline-block size-[8px] rounded-full border-[1.5px] border-[color:var(--risk)] align-middle" /> active official
        warnings (NGA MSI) · wire pins, last 24 h news mentions, refreshed every 6 h —{" "}
        <span className="mx-1 inline-block size-[7px] rounded-full align-middle" style={{ background: "#C0392B" }} /> attack / casualties{" "}
        <span className="mx-1 inline-block size-[7px] rounded-full align-middle" style={{ background: "#F2B950" }} /> boarding / seizure{" "}
        <span className="mx-1 inline-block size-[7px] rounded-full align-middle" style={{ background: "#5E7C93" }} /> weak signal · positions approximate,
        unverified — verified events join the record via the auto feeds
      </p>

      {/* charts row, left to right */}
      <div className="grid gap-10 md:grid-cols-2 xl:grid-cols-3">
        {(
          [
            {
              ref: chartRef,
              slug: "monthly-trend",
              title: "Monthly trend",
              sub: `Incidents per month by type · ${year >= "2025" ? `auto-ingested + brief, ${year}` : year === "all" ? "ASAM + auto-ingested + brief" : year === "2024" ? "ASAM to June, auto after" : `NGA ASAM archive, ${year}`}`,
            },
            { ref: zoneRef, slug: "by-zone", title: "Where", sub: "Incidents by zone, top 8, current filters" },
            { ref: typeRef, slug: "by-type", title: "What", sub: "Incidents by type, current filters" },
          ] as const
        ).map((c) => (
          <div key={c.slug}>
            <p className="flex items-baseline justify-between gap-3">
              <span className="t-serif text-xl">{c.title}</span>
              <button
                onClick={() => exportPlotPNG(c.ref.current, pngName(c.slug))}
                title={`Download “${c.title}” as PNG — ${pngName(c.slug)}`}
                className="t-caps cursor-pointer border border-line-2 rounded-r1 px-2 py-1 !text-ink-3 transition-colors duration-150 hover:border-[color:var(--accent)] hover:!text-accent-text"
              >
                PNG ↓
              </button>
            </p>
            <p className="mt-1 text-sm text-ink-3">{c.sub}</p>
            <div ref={c.ref} className="mt-4 [&_svg]:w-full" />
          </div>
        ))}
      </div>

      {/* incident cards, flowing left to right */}
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <p className="t-serif text-xl">The record</p>
          <div className="ml-auto flex gap-2">
            {th("date", "Date")}
            {th("type", "Type")}
            {th("zone", "Zone")}
          </div>
        </div>
        <div className="grid gap-px bg-[color:var(--line)] sm:grid-cols-2 xl:grid-cols-3">
          {sorted.slice(0, 30).map((i) => (
            <button
              key={i.id}
              onClick={() => focusIncident(i)}
              className="group cursor-pointer bg-bg-0 p-5 text-left transition-colors duration-150 hover:bg-bg-1"
            >
              <p className="t-meta flex justify-between gap-2">
                <span>{fmt.format(new Date(i.date))} · {i.zone}</span>
                <span>{i.id}</span>
              </p>
              <p className="t-caps mt-2" style={{ color: typeVar(i.type) }}>
                <span className="mr-1.5 inline-block size-[7px] align-middle" style={{ background: typeVar(i.type) }} />
                {TYPE_LABELS[i.type]}
              </p>
              {i.vessel && <p className="mt-2 text-[13px] font-medium text-ink">{i.vessel}</p>}
              <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
                {i.summary.length > 170 ? i.summary.slice(0, 170) + "…" : i.summary}
              </p>
              <p className="t-meta mt-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                view on map →
              </p>
            </button>
          ))}
        </div>
        {sorted.length > 30 && (
          <p className="t-meta mt-3">
            showing the 30 most recent of {sorted.length} · refine with the filters or the map
          </p>
        )}
      </div>
    </div>
  );
}
