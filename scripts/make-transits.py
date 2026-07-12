#!/usr/bin/env python3
"""Chokepoint transit counter — parquet AIS -> src/data/transits.json.

Expects parquet files with at least: mmsi, timestamp (UTC), lat, lon.
A transit is counted when a track crosses a chokepoint gate (a segment
between two points) within one continuous passage.

Usage:
    python3 scripts/make-transits.py data/ais/*.parquet

Configure gates below. Runs on DuckDB; no data leaves the machine.
Vessel identities are used only to de-duplicate crossings and are never
exported: the output is weekly counts per gate, nothing else.
"""

import json
import sys
from datetime import datetime
from pathlib import Path

import duckdb

# gate = two (lon, lat) endpoints drawn across the strait
GATES = {
    "bab-el-mandeb": ((43.22, 12.55), (43.55, 12.72)),
    "suez": ((32.52, 29.92), (32.60, 29.92)),
    "good-hope": ((18.20, -34.60), (18.20, -35.50)),
    "hormuz": ((56.10, 26.35), (56.65, 26.75)),
    "malacca": ((103.35, 1.10), (103.60, 1.35)),
    "gibraltar": ((-5.60, 35.85), (-5.60, 36.05)),
    "panama": ((-79.92, 9.35), (-79.55, 9.35)),
    "bosphorus": ((28.98, 41.20), (29.15, 41.20)),
    "danish-straits": ((12.55, 55.85), (12.75, 56.05)),
    "dover": ((1.30, 50.95), (1.75, 51.10)),
    "taiwan-strait": ((119.00, 24.40), (120.20, 24.40)),
}

MIN_GAP_HOURS = 6  # two crossings closer than this are one transit


def main(paths: list[str]) -> None:
    if not paths:
        sys.exit("usage: make-transits.py <parquet files>")
    con = duckdb.connect()
    files = ", ".join(f"'{p}'" for p in paths)
    out: dict[str, dict[str, int]] = {}

    for gate, ((x1, y1), (x2, y2)) in GATES.items():
        # crude but effective: positions within the gate's bounding corridor,
        # one hit per vessel per MIN_GAP_HOURS window = one transit
        rows = con.execute(
            f"""
            WITH hits AS (
              SELECT mmsi,
                     date_trunc('hour', timestamp) AS h,
                     strftime(timestamp, '%Y-W%V') AS week
              FROM read_parquet([{files}])
              WHERE lon BETWEEN LEAST({x1},{x2}) - 0.05 AND GREATEST({x1},{x2}) + 0.05
                AND lat BETWEEN LEAST({y1},{y2}) - 0.05 AND GREATEST({y1},{y2}) + 0.05
            ),
            dedup AS (
              SELECT mmsi, week, h,
                     lag(h) OVER (PARTITION BY mmsi ORDER BY h) AS prev
              FROM (SELECT DISTINCT mmsi, week, h FROM hits)
            )
            SELECT week, count(*) AS transits
            FROM dedup
            WHERE prev IS NULL OR date_diff('hour', prev, h) >= {MIN_GAP_HOURS}
            GROUP BY week ORDER BY week
            """
        ).fetchall()
        out[gate] = {week: int(n) for week, n in rows}
        print(f"{gate}: {sum(out[gate].values())} transits over {len(out[gate])} weeks")

    dest = Path(__file__).parent.parent / "src" / "data" / "transits.json"
    dest.write_text(json.dumps({"generated": datetime.utcnow().isoformat() + "Z", "gates": out}, indent=1))
    print(f"wrote {dest}")


if __name__ == "__main__":
    main(sys.argv[1:])
