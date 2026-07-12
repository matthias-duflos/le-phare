// Live wire: recent worldwide news mentions relevant to maritime risk,
// via the GDELT DOC API (free, ~15 min refresh upstream). These are raw
// news mentions, not verified incidents; they feed the weekly brief's
// research, they are not the incident database.
import { useEffect, useState } from "react";

type Article = { url: string; title: string; domain: string; seendate: string };

const QUERY = encodeURIComponent(
  '("red sea" OR "bab el-mandeb" OR "strait of hormuz" OR "suez canal" OR "shadow fleet" OR "gps jamming" OR piracy) (shipping OR vessel OR tanker OR maritime) sourcelang:english',
);

const fmt = (s: string) =>
  `${s.slice(9, 11)}:${s.slice(11, 13)} UTC · ${s.slice(6, 8)}/${s.slice(4, 6)}`;

const dedupe = (arts: Article[], max: number) => {
  const seen = new Set<string>();
  const out: Article[] = [];
  for (const a of arts) {
    const k = a.title.toLowerCase().slice(0, 55);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
    if (out.length >= max) break;
  }
  return out;
};

export default function AlertsFeed({ max = 10, timespan = "48h" }: { max?: number; timespan?: string }) {
  const URL_ = `https://api.gdeltproject.org/api/v2/doc/doc?query=${QUERY}&mode=artlist&maxrecords=${Math.min(max * 3, 75)}&timespan=${timespan}&format=json&sort=datedesc`;
  const [articles, setArticles] = useState<Article[] | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);

  useEffect(() => {
    // 15-minute session cache protects GDELT's 1-request/5s rate limit
    const CACHE = "phare-wire";
    try {
      const c = JSON.parse(sessionStorage.getItem(CACHE) ?? "null");
      if (c && Date.now() - c.at < 15 * 60000) {
        setArticles(dedupe(c.articles, max));
        return;
      }
    } catch {}
    const useSnapshot = () =>
      fetch("/data/wire.json")
        .then((r) => r.json())
        .then((d) => {
          setArticles(dedupe(d.articles, max));
          setSnapshot(d.fetched?.slice(0, 10) ?? "");
        })
        .catch(() => setArticles([]));
    fetch(URL_)
      .then((r) => r.json())
      .then((d) => {
        if (!d.articles) throw new Error("rate limited");
        sessionStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), articles: d.articles }));
        setArticles(dedupe(d.articles, max));
      })
      .catch(useSnapshot);
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
