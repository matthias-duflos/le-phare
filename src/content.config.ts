import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const briefs = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/briefs" }),
  schema: z.object({
    issue: z.number(),
    title: z.string(),
    dek: z.string(), // one-sentence standfirst under the title
    date: z.coerce.date(),
    period: z.string(), // human-readable coverage window
    chart: z.enum(["transits", "incidents", "none"]).default("none"),
    format: z.enum(["classic", "note"]).default("classic"),
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { briefs };
