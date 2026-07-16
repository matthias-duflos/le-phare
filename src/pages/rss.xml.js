import rss from "@astrojs/rss";
import { getCollection } from "astro:content";

export async function GET(context) {
  const briefs = await getCollection("briefs");
  return rss({
    title: "Le Phare · Weekly Maritime Risk Brief",
    description:
      "Three hundred words and one chart on maritime risk, every Monday.",
    site: context.site ?? "https://le-phare.pages.dev",
    items: briefs
      .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())
      .map((b) => ({
        title: `No. ${b.data.issue} · ${b.data.title}`,
        description: b.data.dek,
        pubDate: b.data.date,
        link: `/brief/${b.id}/`,
      })),
  });
}
