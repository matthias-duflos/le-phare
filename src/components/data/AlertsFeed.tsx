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

export default function AlertsFeed({ max = 10, timespan = "48h" }: { max?: number; timespan?: string }) {
  const URL_ = `https://api.gdeltproject.org/api/v2/doc/doc?query=${QUERY}&mode=artlist&maxrecords=${Math.min(max * 3, 75)}&timespan=${timespan}&format=json&sort=datedesc`;
  const [articles, setArticles] = useState<Article[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch(URL_)
      .then((r) => r.json())
      .then((d) => {
        const seen = new Set<string>();
        const out: Article[] = [];
        for (const a of d.articles ?? []) {
          const key = a.title.toLowerCase().slice(0, 60);
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(a);
          if (out.length >= max) break;
        }
        setArticles(out);
      })
      .catch(() => setFailed(true));
  }, []);

  if (failed)
    return <p className="t-meta">live wire unreachable · the feed returns on the next visit</p>;
  if (!articles) return <p className="t-meta">reading the wire…</p>;

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
        GDELT news mentions, last {timespan.replace("h", " h").replace("d", " days")} ·
        unverified, for research context only · not the incident database
      </p>
    </div>
  );
}
