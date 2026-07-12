// War Risk Zones Atlas: a month slider drives which listed areas are shown,
// overlaid with that month's real incidents from the NGA ASAM archive.
// Perimeters are approximate reconstructions from public circulars.
import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import warzones from "../../data/warzones.json";

type Zone = (typeof warzones)["zones"][number];

const MONTHS: string[] = [];
for (let y = 2022; y <= 2024; y++)
  for (let m = 1; m <= 12; m++) {
    const s = `${y}-${String(m).padStart(2, "0")}`;
    if (s <= "2024-06") MONTHS.push(s);
  }

const label = (m: string) =>
  new Date(m + "-01").toLocaleDateString("en-GB", { month: "short", year: "numeric" });

export default function ZonesAtlas() {
  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [idx, setIdx] = useState(MONTHS.length - 1);
  const [incidents, setIncidents] = useState<any[]>([]);
  const month = MONTHS[idx];

  useEffect(() => {
    fetch("/data/incidents-asam.json")
      .then((r) => r.json())
      .then(setIncidents)
      .catch(() => {});
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
      <div className="mb-4 flex flex-wrap items-center gap-5">
        <input
          type="range"
          min={0}
          max={MONTHS.length - 1}
          value={idx}
          onChange={(e) => setIdx(Number(e.target.value))}
          className="w-full max-w-md accent-[var(--accent)]"
          aria-label="Month"
        />
        <p className="t-num font-mono text-lg text-ink">{label(month)}</p>
        <p className="t-meta ml-auto">
          {activeZones.length} active area{activeZones.length === 1 ? "" : "s"} ·{" "}
          {incGeo.features.length} incidents that month (ASAM)
        </p>
      </div>
      <div
        ref={mapDiv}
        className="h-[500px] w-full border border-line-2 [&_.maplibregl-ctrl-attrib]:!bg-bg-1 [&_.maplibregl-ctrl-attrib]:!text-ink-3 [&_.maplibregl-ctrl-attrib]:!text-[10px]"
      />
      <div className="mt-4 grid gap-2">
        {activeZones.map((z: Zone) => (
          <p key={z.id} className="t-meta">
            <span className="mr-2 inline-block size-[7px] align-middle" style={{ background: "var(--risk)" }} />
            {z.name} · since {label(z.from)}
            {z.to ? ` · retired ${label(z.to)}` : ""} · {z.source}
          </p>
        ))}
      </div>
    </div>
  );
}
