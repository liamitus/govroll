/**
 * URL-safe slug helpers for bill sections. Slugs appear in the reader's
 * URL as `?section=<slug>` and in chat citations as markdown links so a
 * click jumps to the cited section in the reader.
 *
 * Slugs are deterministic functions of the parsed `path[]` produced by
 * `bill-xml-parser.ts` (which `bill-sections.ts` exposes as the joined
 * `heading` field, ` > ` separated). They WILL change between
 * BillTextVersions when amendments shift section paths — that's correct:
 * a permalink to "Section 5(a)" of the introduced version genuinely
 * should not auto-redirect to a different "Section 5(a)" of the
 * engrossed version.
 *
 * For collisions within a single version (rare — would require two
 * sections with identical headings at identical depth), `sectionSlugsForBill`
 * appends `-2`, `-3`, … in document order so each section gets a stable
 * unique ID.
 */

import type { BillSection } from "./bill-sections";

const MAX_SEGMENT_LENGTH = 30;
const SEGMENT_SEPARATOR = "--";

/**
 * Convert a path array to a URL-safe slug.
 *
 * Example:
 *   ["Section 2. Definitions", "(a) In general", "(1) Eligible"]
 *   → "sec-2-definitions--a-in-general--1-eligible"
 */
export function sectionSlug(path: string[]): string {
  return path.map(slugSegment).filter(Boolean).join(SEGMENT_SEPARATOR);
}

/**
 * Recover a path-like array from a `BillSection.heading` string. The
 * stored heading is the joined `path[]` (` > ` separator), so this is
 * the inverse of what `fetch-bill-text.ts` writes to the DB.
 *
 * Single-token headings ("Preamble", "Full Text") are returned as a
 * one-element array.
 */
export function pathFromHeading(heading: string): string[] {
  if (!heading.includes(" > ")) return [heading.trim()].filter(Boolean);
  return heading
    .split(" > ")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Convenience: slug straight from a `BillSection.heading` string. Use
 * `sectionSlugsForBill` when you need a stable set of slugs across the
 * whole bill (handles collisions); use this when you have just one
 * heading and don't care about disambiguation.
 */
export function sectionSlugFromHeading(heading: string): string {
  return sectionSlug(pathFromHeading(heading));
}

/**
 * Compute a stable, unique slug for every section in a bill (in
 * document order). Slugs that collide get a `-2`, `-3`, … suffix. Use
 * this in BOTH places that need slugs:
 *
 *   - the reader render (so URL anchors line up)
 *   - the caption generator (so caption.id matches the URL)
 */
export function sectionSlugsForBill(sections: BillSection[]): string[] {
  const seen = new Map<string, number>();
  return sections.map((s) => {
    const base = sectionSlug(pathFromHeading(s.heading));
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    return occurrence === 1 ? base : `${base}-${occurrence}`;
  });
}

/**
 * Parse a slug back to its segments. Reverse of `sectionSlug` (lossy —
 * the original heading text is not recoverable, but the structural
 * shape is enough for fuzzy matching and breadcrumb display).
 */
export function parseSlug(slug: string): string[] {
  if (!slug) return [];
  return slug.split(SEGMENT_SEPARATOR).filter(Boolean);
}

/**
 * Find a section in the parsed list whose slug matches. Strategy:
 *   1. Exact slug match (preferred — same path, same version).
 *   2. First-segment fuzzy match — if "sec-5--…" doesn't resolve, find
 *      the first section whose top-level slug equals "sec-5". Useful
 *      when a permalink survives across versions where downstream
 *      segments shifted but the top-level section number stayed.
 *
 * Returns `{ index, section }` on match, `null` on miss.
 */
export function matchSectionBySlug(
  sections: BillSection[],
  slug: string,
): { index: number; section: BillSection } | null {
  if (!slug || sections.length === 0) return null;

  const slugs = sectionSlugsForBill(sections);

  // Exact match first
  for (let i = 0; i < slugs.length; i++) {
    if (slugs[i] === slug) return { index: i, section: sections[i] };
  }

  // Fuzzy: first-segment prefix match. The user's slug's first segment
  // might be just "sec-3" while the section's actual first segment is
  // "sec-3-funding" — accept either an exact match or a `${query}-`
  // prefix so deep links to renumbered subsections still resolve to
  // the right top-level section.
  const firstSegment = slug.split(SEGMENT_SEPARATOR)[0];
  if (!firstSegment) return null;

  for (let i = 0; i < slugs.length; i++) {
    const candidateFirst = slugs[i].split(SEGMENT_SEPARATOR)[0];
    if (
      candidateFirst === firstSegment ||
      candidateFirst.startsWith(`${firstSegment}-`)
    ) {
      return { index: i, section: sections[i] };
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────
//  Internals
// ─────────────────────────────────────────────────────────────────────────

function slugSegment(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/section\s+/g, "sec-")
    .replace(/division\s+/g, "div-")
    .replace(/subtitle\s+/g, "subt-")
    .replace(/title\s+/g, "title-")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SEGMENT_LENGTH)
    .replace(/-+$/, "");
}
