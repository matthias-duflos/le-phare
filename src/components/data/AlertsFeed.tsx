// The wire: recent worldwide news mentions relevant to maritime risk, from
// the GDELT snapshot the cron refreshes every 6 hours (GDELT's API is not
// callable from a browser — no CORS). These are raw news mentions, not
// verified incidents; they feed the weekly brief's research, they are not
// the incident database.
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
    // one shared snapshot read for the feed AND the map pins
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
    return <p className="t-meta">wire temporarily unreachable · the snapshot returns on the next refresh</p>;

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
        {snapshot ? ` · snapshot ${snapshot}, refreshed every 6 h` : ""} ·
        unverified, for research context only · not the incident database
      </p>
    </div>
  );
}
