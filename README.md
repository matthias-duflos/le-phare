# Le Phare — Maritime Risk Observatory

Independent open-source monitoring of maritime risk: incidents, chokepoint
transits and AIS integrity, read from open sources.

**Live:** https://le-phare.pages.dev

## What ships every Monday

A GitHub Actions cron (`.github/workflows/weekly-brief.yml`, Mondays 06:10 UTC)
refreshes the data and writes the weekly brief, then pushes — the push triggers
the site deployment:

| Script | Source | Output |
|---|---|---|
| `scripts/fetch-portwatch.mjs` | IMF PortWatch daily transit calls | `src/data/transits-weekly.json`, `public/data/portwatch.json` |
| `scripts/fetch-navarea.mjs` | NGA MSI broadcast warnings | `public/data/navarea.json` |
| `scripts/fetch-wire.mjs` | GDELT | `public/data/wire.json` |
| `scripts/fetch-anomalies.mjs` | aisstream.io live sampling (~12 min, 6 zones) | `src/data/anomalies.json` — zone-level counts only, never a vessel |
| `scripts/make-brief.mjs` | all of the above | `src/content/briefs/<date>.md` |

The AIS integrity session needs the `AISSTREAM_KEY` repository secret
(free key at [aisstream.io](https://aisstream.io)); without it the step
skips cleanly.

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

Cloudflare Pages, connected to this repo:
build command `npm run build`, output directory `dist`,
environment variable `NODE_VERSION=22`. Set `SITE=https://…` at build time
once a custom domain is attached (defaults to the pages.dev URL).

## Honesty rules

Every figure on the site names its source and its limits (see `/methodology`
and `/sources`). The incident record is ASAM archive + hand-curated public
reporting, source-linked per event. The AIS integrity watch aggregates by
zone only — no vessel name, MMSI or IMO is ever written. Where coverage is
thin, the page says so.
