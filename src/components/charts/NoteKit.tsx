// Layout kit for intelligence notes (.mdx briefs with format: "note").
// Statically rendered React: structure only, no hooks — the charts inside
// carry their own client directives.
import type { ReactNode } from "react";

/** Full-bleed note section: text column + sticky aside for the figure. */
export function NoteGrid({ children }: { children: ReactNode }) {
  return <section className="grid gap-x-12 gap-y-10 border-t border-line py-12 lg:grid-cols-12">{children}</section>;
}

export function NoteText({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <div className="lg:col-span-7">
      <p className="t-caps">{kicker}</p>
      <h2 className="t-serif mt-3 max-w-[26ch] text-[clamp(1.6rem,2.6vw,2.2rem)]">{title}</h2>
      <div className="prose-brief mt-6">{children}</div>
    </div>
  );
}

export function NoteAside({ children }: { children: ReactNode }) {
  return <aside className="self-start lg:sticky lg:top-24 lg:col-span-5">{children}</aside>;
}

/** FT-convention figure: title states the conclusion, source closes in mono. */
export function Fig({ title, subtitle, source, children }: { title: string; subtitle: string; source: string; children: ReactNode }) {
  return (
    <figure className="border-t border-line-2 pt-4">
      <figcaption className="mb-4">
        <p className="t-serif text-[1.35rem] text-ink">{title}</p>
        <p className="mt-1 text-sm text-ink-3">{subtitle}</p>
      </figcaption>
      {children}
      <p className="t-meta mt-3">{source} · Graphic: Le Phare</p>
    </figure>
  );
}

/** Key figures strip under the lead. */
export function KeyFigs({ items }: { items: { v: string; l: string }[] }) {
  return (
    <div className="mt-8 grid grid-cols-2 gap-x-8 gap-y-6 border-t border-line-2 pt-5 sm:grid-cols-4">
      {items.map((it) => (
        <div key={it.l}>
          <p className="t-num font-mono text-[1.65rem] leading-none text-accent-text">{it.v}</p>
          <p className="t-meta mt-2 leading-snug">{it.l}</p>
        </div>
      ))}
    </div>
  );
}

/** One line of the signals ledger. */
export function Signal({ flag, title, children }: { flag?: "risk" | "watch"; title: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 border-t border-line-2 py-4 md:grid-cols-12">
      <p className="md:col-span-3">
        {flag && (
          <span className={`t-caps ${flag === "risk" ? "!text-risk-text" : "!text-accent-text"}`}>
            <span className="mr-1.5 inline-block size-[7px] align-middle" style={{ background: flag === "risk" ? "var(--risk)" : "var(--accent)" }} />
          </span>
        )}
        <span className="text-sm font-medium text-ink">{title}</span>
      </p>
      <p className="max-w-[70ch] text-sm leading-relaxed text-ink-2 md:col-span-9">{children}</p>
    </div>
  );
}
