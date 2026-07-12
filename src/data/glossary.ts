export type GlossaryCat = "Insurance" | "Chartering" | "Navigation" | "Security" | "Legal";

export type GlossaryEntry = {
  slug: string;
  term: string;
  cat: GlossaryCat;
  pron?: string;
  def: string;
  related: string[];
};

import { entriesA } from "./glossary-a";
import { entriesB } from "./glossary-b";

export const CATEGORIES: GlossaryCat[] = ["Insurance", "Chartering", "Navigation", "Security", "Legal"];

export const glossary: GlossaryEntry[] = [...entriesA, ...entriesB].sort((a, b) =>
  a.term.localeCompare(b.term, "en", { sensitivity: "base" }),
);

const bySlug = new Map(glossary.map((e) => [e.slug, e]));
export const resolveRelated = (slugs: string[]) =>
  slugs.map((s) => bySlug.get(s)).filter((e): e is GlossaryEntry => Boolean(e));
