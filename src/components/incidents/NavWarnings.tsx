// Active official NAVAREA / HYDRO warnings relevant to maritime security,
// from NGA MSI (public domain, live feed — unlike the closed ASAM archive).
import { useEffect, useState } from "react";

type W = { ref: string; text: string; issued?: string | null };

export default function NavWarnings() {
  const [data, setData] = useState<{ fetched: string; total: number; warnings: W[] } | null>(null);
  useEffect(() => {
    fetch("/data/navarea.json").then((r) => r.json()).then(setData).catch(() => {});
  }, []);
  if (!data) return <p className="t-meta">loading official warnings…</p>;
  return (
    <div>
      <p className="t-meta mb-4">
        {data.warnings.length} security-relevant of {data.total} active warnings · NGA MSI,
        public domain · snapshot {data.fetched} · refreshed with each data update
      </p>
      <div className="grid gap-0">
        {data.warnings.map((w) => (
          <details key={w.ref} className="group border-b border-line py-3">
            <summary className="cursor-pointer list-none">
              <span className="t-caps !text-accent-text">{w.ref}</span>
              <span className="ml-3 text-sm text-ink-2">
                {w.text.slice(0, 90)}…{" "}
                <span className="t-meta">(open)</span>
              </span>
            </summary>
            <p className="t-meta mt-3 max-w-[90ch] whitespace-pre-wrap leading-relaxed">{w.text}</p>
          </details>
        ))}
        {data.warnings.length === 0 && (
          <p className="text-sm text-ink-2">
            No active security-relevant warnings in the NGA feed right now; the
            section fills automatically when they are broadcast.
          </p>
        )}
      </div>
    </div>
  );
}
