// Live wire: recent worldwide news mentions relevant to maritime risk,
// via the GDELT DOC API (free, ~15 min refresh upstream). These are raw
// news mentions, not verified incidents; they feed the weekly brief's
// research, they are not the incident database.
import { useEffect, useState } from "react";
import { getWireArticles, type WireArticle } from "../../lib/wire";

const fmt = (s: string) =>
  `${s.slice(9, 11)}:${s.slice(11, 13)} UTC · ${s.slice(6, 8)}/${s.slice(4, 6)}`;

const dedupe = (arts: WireArticle[], max: number) => {
  const seen = new Set<string>();
  const out: WireArticle[] = [];
  for (const a of arts) {
    const k = a.title.toLowerCase().slice(0, 55);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
    if (out.length >= max) break;
  }
  return out;
};

export default function AlertsFeed({ max = 10, timespan = "7d" }: { max?: number; timespan?: string }) {
  const [articles, setArticles] = useState<WireArticle[] | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);

  useEffect(() => {
    let gone = false;
    // snapshot first: the weekly wire.json paints instantly, then the shared
    // live fetch (one GDELT call for the feed AND the map pins) replaces it.
    fetch("/data/wire.json")
      .then((r) => r.json())
      .then((d) => {
        if (gone) return;
        setArticles((cur) => cur ?? dedupe(d.articles, max));
        setSnapshot((cur) => cur ?? (d.fetched?.slice(0, 10) ?? ""));
      })
      .catch(() => {});
    getWireArticles().then(({ articles: arts, snapshot: snap }) => {
      if (gone) return;
      setArticles(dedupe(arts, max));
      setSnapshot(snap);
    });
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!articles) return <p className="t-meta">reading the wire…</p>;
  if (articles.length === 0)
    return <p className="t-meta">wire temporarily unreachable · the weekly snapshot returns shortly</p>;

  return (
    <div>
      <ol className="grid gap-0">
        {articles.map((a) => (
          <li key={a.url} className="border-b border-line py-3">
            <a href={a.url} target="_blank" rel="noopener" className="group block">
              <p className="t-meta">{fmt(a.seendate)} · {a.domain}</p>
              <p className="mt-1 text-[15px] leading-snug text-ink transition-colors duration-150 group-hover:text-accent-text">
                {a.title}
              </p>
            </a>
          </li>
        ))}
      </ol>
      <p className="t-meta mt-4">
        GDELT news mentions, last {timespan.replace("h", " h").replace("d", " days")}
        {snapshot ? ` · snapshot ${snapshot} (live feed rate-limited)` : " · live"} ·
        unverified, for research context only · not the incident database
      </p>
    </div>
  );
}
