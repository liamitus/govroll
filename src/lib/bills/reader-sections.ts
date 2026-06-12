import { parseSectionsFromFullText } from "@/lib/bill-sections";
import { sectionSlugsForBill, pathFromHeading } from "@/lib/section-slug";
import type { SectionCaption } from "@/lib/section-caption";
import type { ReaderSection } from "@/components/bills/reader/reader-types";

/**
 * Parse a bill version's `fullText` into the merged `ReaderSection[]` the
 * reader renders — each parsed section with its stable slug, visual depth,
 * and AI caption (if any) attached.
 *
 * Shared by the reader RSC page (which server-renders the latest version
 * for full-route ISR) and the version-fetch API route (which serves older
 * versions for the client-side `?v=` switcher), so both paths produce
 * byte-identical section shapes from the same inputs.
 *
 * `sectionCaptions` is the version's stored caption JSON (`unknown` because
 * Prisma types Json columns loosely); non-array values degrade to "no
 * captions" rather than throwing.
 */
export function buildReaderSections(
  fullText: string,
  sectionCaptions: unknown,
): ReaderSection[] {
  const parsed = parseSectionsFromFullText(fullText);
  if (parsed.length === 0) return [];

  const slugs = sectionSlugsForBill(parsed);
  const captions: SectionCaption[] = Array.isArray(sectionCaptions)
    ? (sectionCaptions as SectionCaption[])
    : [];
  const captionMap = new Map(captions.map((c) => [c.sectionId, c.caption]));

  return parsed.map((s, i) => ({
    ...s,
    slug: slugs[i],
    depth: pathFromHeading(s.heading).length,
    caption: captionMap.get(slugs[i]) ?? null,
  }));
}
