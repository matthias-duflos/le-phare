// ISO-week helpers: PortWatch aggregates arrive keyed "2026-W28"; readers
// deserve the actual dates behind the week number.

/** Monday of an ISO week string like "2026-W28". */
export function isoWeekStart(week: string): Date {
  const [y, w] = week.split("-W").map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (w - 1) * 7);
  return monday;
}

/** Sunday (last day) of an ISO week string. */
export function isoWeekEnd(week: string): Date {
  const d = isoWeekStart(week);
  d.setUTCDate(d.getUTCDate() + 6);
  return d;
}

const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** "2026-W28" → "W28 · to 12 Jul" */
export function weekLabel(week?: string | null): string {
  if (!week) return "";
  return `${week.slice(5)} · to ${fmt.format(isoWeekEnd(week))}`;
}
