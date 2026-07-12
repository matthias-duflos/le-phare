// War Risk Zones Atlas: a month slider drives which listed areas are shown,
// overlaid with that month's real incidents from the NGA ASAM archive.
// Perimeters are approximate reconstructions from public circulars.
import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import warzones from "../../data/warzones.json";
import curated from "../../data/incidents.json";

type Zone = (typeof warzones)["zones"][number];

const MONTHS: string[] = [];
for (let y = 2022; y <= 2026; y++)
  for (let m = 1; m <= 12; m++) {
    const s = `${y}-${String(m).padStart(2, "0")}`;
    if (s <= "2026-07") MONTHS.push(s);
  }

const label = (m: string) =>
  new Date(m + "-01").toLocaleDateString("en-GB", { month: "short", year: "numeric" });

export default function ZonesAtlas() {
  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [idx, setIdx] = useState(MONTHS.length - 1);
  const [playing, setPlaying] = useState(false);
  const [incidents, setIncidents] = useState<any[]>([]);
  const month = MONTHS[idx];

  // play the timeline like a film
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setIdx((i) => {
        if (i >= MONTHS.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 650);
    return () => clearInterval(t);
  }, [playing]);

  const monthCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of incidents) {
      const k = i.date.slice(0, 7);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return MONTHS.map((k) => m.get(k) ?? 0);
  }, [incidents]);
  const maxCount = Math.max(...monthCounts, 1);

  const inZone = (z: Zone, i: any) => {
    const lons = z.polygon.map((p) => p[0]);
    const lats = z.polygon.map((p) => p[1]);
    return (
      i.lon >= Math.min(...lons) && i.lon <= Math.max(...lons) &&
      i.lat >= Math.min(...lats) && i.lat <= Math.max(...lats)
    );
  };

  useEffect(() => {
    fetch("/data/incidents-asam.json")
      .then((r) => r.json())
      .then((asam) => setIncidents([...asam, ...curated]))
      .catch(() => setIncidents([...curated]));
  }, []);

  const activeZones = useMemo(
    () => warzones.zones.filter((z) => z.from <= month && (!z.to || month < z.to)),
    [month],
  );

  const zoneGeo = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: activeZones.map((z: Zone) => ({
        type: "Feature" as const,
        properties: { name: z.name, kind: z.kind },
        geometry: { type: "Polygon" as const, coordinates: [[...z.polygon, z.polygon[0]]] },
      })),
    }),
    [activeZones],
  );

  const incGeo = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: incidents
        .filter((i) => i.date.slice(0, 7) === month)
        .map((i) => ({
          type: "Feature" as const,
          properties: {},
          geometry: { type: "Point" as const, coordinates: [i.lon, i.lat] },
        })),
    }),
    [incidents, month],
  );

  useEffect(() => {
    if (!mapDiv.current) return;
    const map = new maplibregl.Map({
      container: mapDiv.current,
      style: "/map/abyss.json",
      center: [46, 20],
      zoom: 2.8,
      attributionControl: { compact: true },
      cooperativeGestures: true,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    map.on("load", () => {
      map.addSource("zones", { type: "geojson", data: zoneGeo });
      map.addSource("month-incidents", { type: "geojson", data: incGeo });
      map.addLayer({
        id: "zone-fill",
        type: "fill",
        source: "zones",
        paint: { "fill-color": "#C0392B", "fill-opacity": 0.13 },
      });
      map.addLayer({
        id: "zone-line",
        type: "line",
        source: "zones",
        paint: { "line-color": "#C0392B", "line-width": 1.2, "line-dasharray": [3, 2] },
      });
      map.addLayer({
        id: "zone-label",
        type: "symbol",
        source: "zones",
        layout: {
          "text-field": ["get", "name"],
          "text-size": 11,
          "text-font": ["Noto Sans Regular"],
          "text-transform": "uppercase",
          "text-letter-spacing": 0.1,
        },
        paint: { "text-color": "#E06B54", "text-halo-color": "#0A1622", "text-halo-width": 1.2 },
      });
      map.addLayer({
        id: "month-dots",
        type: "circle",
        source: "month-incidents",
        paint: {
          "circle-radius": 3.5,
          "circle-color": "#F2B950",
          "circle-opacity": 0.85,
          "circle-stroke-color": "rgba(10,22,34,0.8)",
          "circle-stroke-width": 1,
        },
      });
    });
    return () => map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      (map.getSource("zones") as maplibregl.GeoJSONSource | undefined)?.setData(zoneGeo as any);
      (map.getSource("month-incidents") as maplibregl.GeoJSONSource | undefined)?.setData(incGeo as any);
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [zoneGeo, incGeo]);

  return (
    <div>
      {/* controls */}
      <div className="mb-2 flex flex-wrap items-center gap-4">
        <button
          onClick={() => {
            if (!playing && idx >= MONTHS.length - 1) setIdx(0);
            setPlaying((p) => !p);
          }}
          className="btn-beam t-caps cursor-pointer bg-accent !text-accent-ink rounded-r1 px-4 py-2"
        >
          {playing ? "Pause" : "Play the timeline"}
        </button>
        <input
          type="range"
          min={0}
          max={MONTHS.length - 1}
          value={idx}
          onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }}
          className="min-w-[200px] flex-1 accent-[var(--accent)]"
          aria-label="Month"
        />
        <p className="t-num w-[90px] font-mono text-lg text-ink">{label(month)}</p>
      </div>

      {/* monthly incident strip: context + scrubber */}
      <div className="mb-5 flex h-12 items-end gap-[3px]" aria-hidden="true">
        {monthCounts.map((c, i) => (
          <button
            key={MONTHS[i]}
            onClick={() => { setPlaying(false); setIdx(i); }}
            title={`${label(MONTHS[i])} · ${c} incidents`}
            className="min-w-0 flex-1 cursor-pointer transition-opacity duration-150 hover:opacity-100"
            style={{
              height: `${Math.max((c / maxCount) * 100, 4)}%`,
              background: i === idx ? "var(--accent)" : "var(--viz-context)",
              opacity: i === idx ? 1 : 0.55,
            }}
          />
        ))}
      </div>

      {/* stats row */}
      <div className="mb-4 flex flex-wrap gap-x-8 gap-y-1">
        <p className="t-meta"><span className="t-num font-mono text-base text-ink">{activeZones.length}</span> active area{activeZones.length === 1 ? "" : "s"}</p>
        <p className="t-meta"><span className="t-num font-mono text-base text-ink">{incGeo.features.length}</span> incidents that month · {month >= "2024-07" ? "curated, sample" : "ASAM"}</p>
        <p className="t-meta ml-auto">
          perimeters approximate · ASAM recorded piracy-type acts: state
          seizures and jamming are under-counted
        </p>
      </div>

      <div
        ref={mapDiv}
        className="h-[500px] w-full border border-line-2 [&_.maplibregl-ctrl-attrib]:!bg-bg-1 [&_.maplibregl-ctrl-attrib]:!text-ink-3 [&_.maplibregl-ctrl-attrib]:!text-[10px]"
      />

      {/* zone cards */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {activeZones.map((z: Zone) => {
          const n = incidents.filter((i) => i.date.slice(0, 7) === month && inZone(z, i)).length;
          return (
            <button
              key={z.id}
              onClick={() => {
                const lons = z.polygon.map((p) => p[0]);
                const lats = z.polygon.map((p) => p[1]);
                mapRef.current?.fitBounds(
                  [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
                  { padding: 60, duration: 900 },
                );
              }}
              className="group cursor-pointer border border-line border-l-2 border-l-[color:var(--risk)] bg-bg-0 p-5 text-left transition-colors duration-150 hover:bg-bg-1"
            >
              <p className="t-serif text-lg transition-colors duration-150 group-hover:text-accent-text">{z.name}</p>
              <p className="t-caps mt-1">{z.kind === "hra" ? "High risk area" : "Listed area"}</p>
              <p className="t-meta mt-2">
                since {label(z.from)}{z.to ? ` · retired ${label(z.to)}` : " · still active"}
                <br />{z.source}
              </p>
              <p className="t-num mt-3 font-mono text-sm text-ink">
                {n} incident{n === 1 ? "" : "s"} inside · {label(month)}
              </p>
            </button>
          );
        })}
        {activeZones.length === 0 && (
          <p className="bg-bg-0 p-5 text-sm text-ink-2">No listed area active at this date.</p>
        )}
      </div>
    </div>
  );
}
