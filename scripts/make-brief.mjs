// Auto-generates the weekly maritime risk brief from live data:
// PortWatch weekly aggregates (+ computed alerts), active NAVAREA warnings,
// and the GDELT wire. Writes src/content/briefs/<publication date>.md
// (date-based slugs keep /brief/ URLs in chronological order).
// Idempotent: refuses to write twice for the same data week or the same day.
// Run after fetch-portwatch & fetch-navarea:  node scripts/make-brief.mjs

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";

const weekly = JSON.parse(readFileSync(new URL("../src/data/transits-weekly.json", import.meta.url)));
const navarea = JSON.parse(readFileSync(new URL("../public/data/navarea.json", import.meta.url)));

const cps = Object.values(weekly.chokepoints);
const week = cps[0].week; // e.g. 2026-W27
const today = new Date().toISOString().slice(0, 10);
const slugFile = `${today}.md`;
const dest = new URL(`../src/content/briefs/${slugFile}`, import.meta.url);

const briefsDir = new URL("../src/content/briefs/", import.meta.url);
const issues = readdirSync(briefsDir).filter((f) => f.endsWith(".md") || f.endsWith(".mdx"));
const alreadyCovered = issues.some((f) => readFileSync(new URL(f, briefsDir), "utf8").includes(`data week ${week}`));
if (alreadyCovered || existsSync(dest)) {
  console.log(`brief for ${alreadyCovered ? `data week ${week}` : today} already exists, nothing to do`);
  process.exit(0);
}

const issueNo = issues.length + 1;

const alerts = cps.filter((c) => c.status && c.status !== "normal");
const critical = alerts.find((c) => c.status === "critical");
const movers = [...cps].filter((c) => c.delta != null).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
const up = movers.filter((c) => c.delta > 0)[0];
const down = movers.filter((c) => c.delta < 0)[0];
const rer = weekly.rerouting.at(-1);
const bab = weekly.chokepoints["bab-el-mandeb"];

// ---- the wire (GDELT), tolerant of rate limits ----
let wire = [];
try {
  const q = encodeURIComponent(
    '("red sea" OR "strait of hormuz" OR "suez canal" OR "shadow fleet" OR piracy) (shipping OR vessel OR tanker OR maritime) sourcelang:english',
  );
  const res = await fetch(
    `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=artlist&maxrecords=20&timespan=7d&format=json&sort=hybridrel`,
  );
  const d = await res.json();
  const seen = new Set();
  for (const a of d.articles ?? []) {
    const k = a.title.toLowerCase().slice(0, 55);
    if (seen.has(k)) continue;
    seen.add(k);
    wire.push({ title: a.title.trim(), url: a.url, domain: a.domain });
    if (wire.length >= 5) break;
  }
} catch {
  /* the brief ships without the wire section */
}

const pct = (c) => `${c.pct}% of its 2024-25 baseline`;
const title = critical
  ? `${critical.name} runs at ${critical.pct}% of normal`
  : up
    ? `${up.name} leads the week's movements`
    : `A quiet week on the water`;
const dek = critical
  ? `${critical.last} weekly transit calls against a ~${critical.baseline} baseline${critical.trend === "recovering" ? ", but the reopening is gathering pace" : ""}; the Cape still carries ${rer?.idx}× Suez's traffic.`
  : `Rerouting index at ${rer?.idx}; ${bab.last} weekly transit calls through Bab el-Mandeb.`;

const alertLines = alerts.length
  ? alerts.map((a) => `${a.name} is flagged **${a.status}** at ${pct(a)} (${a.last} against ~${a.baseline} weekly calls${a.trend ? `, ${a.trend}` : ""}).`).join(" ")
  : "No chokepoint is flagged against its 2024-25 baseline this week.";

const body = `${alertLines}

The Red Sea corridor shows no structural change: ${bab.last} transit calls
through Bab el-Mandeb in ${week.slice(5)} (${bab.delta >= 0 ? "+" : ""}${bab.delta} on the week), and the
rerouting index stands at ${rer?.idx}, meaning the Cape of Good Hope carries
${rer?.idx} times the traffic of Suez. Above 1, the long way round is still
the market's default.

Movement of the week: ${up ? `${up.name}, up ${up.delta} calls week-on-week` : "none of note"}${down ? `; the sharpest decline is ${down.name}, ${down.delta}` : ""}.
The official picture: ${navarea.warnings.length} security-relevant NAVAREA or
HYDRO warning${navarea.warnings.length === 1 ? "" : "s"} active out of ${navarea.total} broadcast
(snapshot ${navarea.fetched}).
${
  wire.length
    ? `
On the wire this week, for context and unverified:

${wire.map((w) => `- [${w.title}](${w.url}) (${w.domain})`).join("\n")}
`
    : ""
}
This issue was generated automatically from IMF PortWatch daily transit
data, NGA MSI broadcast warnings and the GDELT wire, using the
observatory's published methodology. Figures are as retrieved on ${today}.
`;

const md = `---
issue: ${issueNo}
title: "${title.replace(/"/g, "'")}"
dek: "${dek.replace(/"/g, "'")}"
date: ${today}
period: "data week ${week} · to ${weekly.updated}"
chart: transits
tags: ["auto-generated", "chokepoints", "war-risk"]
---

${body}`;

writeFileSync(dest, md);
console.log(`brief no. ${issueNo} written: ${slugFile} — "${title}"`);
