# Le Phare — Maritime Risk Observatory

Independent, open-source monitoring of maritime risk at world scale:
strait transits across the 12 chokepoints of global trade, a four-year
incident database, an AIS integrity watch, a war-risk zones atlas and an
auto-generated weekly brief — all from open sources, all source-linked.

**Live:** https://le-phare.pages.dev

## What the observatory covers

| Module | Page | What it shows |
|---|---|---|
| Strait Transit Monitor | `/straits`, `/straits/<slug>` | Weekly transit calls across 12 chokepoints (Bab el-Mandeb, Suez, Good Hope, Hormuz, Malacca, Gibraltar, Panama, Bosphorus, Danish Straits, Dover, Taiwan Strait, Kerch), Suez-vs-Cape rerouting index, per-strait status alerts |
| Live watch | on `/straits` pages | One background aisstream.io stream over 13 zones (the 12 straits + full Baltic), ghost picture warm-started from a seed snapshot, arrival halos, per-strait "good picture" target |
| Maritime Incident Database | `/incidents` | 2022 → today: NGA ASAM archive (2022 – Jun 2024, programme defunded) + automated ReCAAP/IMB ingestion since Jul 2024 (~390 events, deduplicated) + a hand-curated, source-linked 2026 record |
| AIS Integrity Watch | `/anomalies` | Bounded listening sessions over 6 zones, 5 heuristics (jamming clusters, impossible jumps, speed anomalies, dark gaps, positions on land) — zone-level counts only, never a vessel |
| War Risk Zones Atlas | `/zones` | JWC-derived perimeters, reconstructed and explicitly non-authoritative |
| Weekly Brief | `/brief` | Auto-generated every Monday from the week's data, plus hand-written intelligence notes (MDX) |
| Data Lab | `/data` | Every dataset the site runs on, explorable and exportable (charts export to PNG) |
| Lexicon | `/glossary` | The vocabulary of maritime risk, cross-linked from the rest of the site |
| Method | `/methodology`, `/sources`, `/about` | How every number is made, what it can and cannot say |

## Automated pipelines

Two GitHub Actions keep the site alive without any manual step; every
commit they push triggers the Cloudflare Pages deployment.

**`weekly-brief.yml`** — Mondays 06:10 UTC (after IMF PortWatch's weekly update):

| Script | Source | Output |
|---|---|---|
| `scripts/fetch-portwatch.mjs` | IMF PortWatch daily transit calls | `src/data/transits-weekly.json`, `public/data/portwatch.json` |
| `scripts/fetch-navarea.mjs` | NGA MSI broadcast warnings | `public/data/navarea.json` |
| `scripts/fetch-wire.mjs` | GDELT | `public/data/wire.json` |
| `scripts/fetch-incidents-live.mjs` | ReCAAP ISC + IMB PRC official feeds | `public/data/incidents-live.json` |
| `scripts/fetch-anomalies.mjs` | aisstream.io bounded session (~12 min, 6 zones) | `src/data/anomalies.json` — zone-level counts only |
| `scripts/make-brief.mjs` | all of the above | `src/content/briefs/<date>.md` (idempotent per data week) |

**`live-refresh.yml`** — every 6 hours, commits only on change:
incidents (ReCAAP/IMB), active NAVAREA warnings, the GDELT wire, and a
2-minute AIS seed session (`scripts/fetch-ais-seed.mjs`) so the live maps
open on a fresh ghost picture instead of an empty sea.

One-off / tooling scripts: `fetch-asam.mjs` (historical ASAM archive),
`make-map-style.mjs`, `make-world-dots.mjs`, `make-og.mjs`, `shoot.mjs`
(Playwright screenshots), `bench-ais.mjs` / `bench-boxes.mjs`.

The AIS scripts need the `AISSTREAM_KEY` repository secret (free key at
[aisstream.io](https://aisstream.io)); without it they skip cleanly.

## Stack

Astro 7 (static output) + React 19 islands, Tailwind 4, MapLibre GL,
three.js (home globe), Observable Plot + D3 (charts), GSAP + Lenis
(motion). Content collections for briefs (Markdown/MDX), RSS at
`/rss.xml`.

## Development

```sh
npm install
npm run dev        # localhost:4321
npm run build      # production build in dist/
```

Live AIS panels in dev need `PUBLIC_AISSTREAM_KEY` in `.env` (never
committed). `node --env-file=.env scripts/fetch-anomalies.mjs` runs a local
integrity session.

## Deployment

Cloudflare Pages, connected to this repo: build command `npm run build`,
output directory `dist`, environment variable `NODE_VERSION=22`. Set
`SITE=https://…` at build time once a custom domain is attached (defaults
to the pages.dev URL).

## Honesty rules

Every figure on the site names its source and its limits (see `/methodology`
and `/sources`). The incident record is official archives and feeds
(ASAM, ReCAAP, IMB) plus hand-curated public reporting, source-linked per
event. The AIS integrity watch and the live seed aggregate by zone only —
no vessel name, MMSI or IMO is ever written to disk. Where coverage is
thin, the page says so.
