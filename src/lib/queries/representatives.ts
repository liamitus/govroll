import "server-only";
import { prisma } from "@/lib/prisma";
import { expandQueryVariants } from "@/lib/representative-name-aliases";
import type { RepresentativeInfo } from "@/types";

export interface RepSearchResult extends RepresentativeInfo {
  /**
   * Match tier — lets the UI surface a "matched on bioguide" or
   * "matched on full name" hint if we ever want it. Cheap byproduct of
   * the ranking CASE in the SQL; not currently rendered.
   */
  matchTier: number;
}

/**
 * Tiny full-name search across the Representative table. The full set is
 * ~540 rows so a sequential scan is faster than maintaining a tsvector,
 * and ILIKE prefix matching covers the realistic queries: a last name
 * ("Schumer"), a first+last ("Chuck Schumer"), or a bioguide id
 * ("S000148"). Trigram is intentionally NOT used here — adding typo
 * tolerance to a 540-row table buys little but slows the rank predicate
 * enough to be worth deferring until the demand is real.
 *
 * Nicknames + acronyms are handled via query expansion (see
 * representative-name-aliases.ts): "Bernie Sanders" runs as both
 * "bernie sanders" AND "bernard sanders" so the canonical record is
 * still findable. Each variant is a cheap ILIKE on 540 rows; a couple
 * of extra round trips is the right tradeoff vs. maintaining an alias
 * column on the data model.
 */
export async function searchRepresentatives(
  query: string,
  limit = 5,
): Promise<RepSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const variants = expandQueryVariants(trimmed);
  const variantResults = await Promise.all(
    variants.map((v) => runVariantQuery(v, limit)),
  );

  // Merge across variants, keep the lowest matchTier per rep so the
  // canonical-name hit ("bernard sanders") doesn't get pushed below the
  // raw-typed hit ("bernie sanders") just because it came from a later
  // variant in the list. Sort + cap once at the end.
  const byId = new Map<number, RepSearchResult>();
  for (const list of variantResults) {
    for (const r of list) {
      const prev = byId.get(r.id);
      if (!prev || r.matchTier < prev.matchTier) byId.set(r.id, r);
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => {
      if (a.matchTier !== b.matchTier) return a.matchTier - b.matchTier;
      if (a.lastName !== b.lastName)
        return a.lastName.localeCompare(b.lastName);
      return a.firstName.localeCompare(b.firstName);
    })
    .slice(0, limit);
}

async function runVariantQuery(
  term: string,
  limit: number,
): Promise<RepSearchResult[]> {
  // Match conditions are arranged so the highest-signal hit (last-name
  // prefix) is also tier 0 in the ORDER BY, keeping ranking and
  // membership in lockstep without a second pass.
  const rows = await prisma.$queryRaw<RawRepRow[]>`
    SELECT
      id,
      "bioguideId",
      slug,
      "firstName",
      "lastName",
      state,
      district,
      party,
      chamber,
      "imageUrl",
      link,
      phone,
      CASE
        WHEN "lastName" ILIKE ${term + "%"} THEN 0
        WHEN ("firstName" || ' ' || "lastName") ILIKE ${term + "%"} THEN 1
        WHEN "firstName" ILIKE ${term + "%"} THEN 2
        WHEN "bioguideId" ILIKE ${term + "%"} THEN 3
        ELSE 4
      END AS "matchTier"
    FROM "Representative"
    WHERE
      "lastName" ILIKE ${term + "%"}
      OR "firstName" ILIKE ${term + "%"}
      OR ("firstName" || ' ' || "lastName") ILIKE ${"%" + term + "%"}
      OR "bioguideId" ILIKE ${term + "%"}
    ORDER BY "matchTier" ASC, "lastName" ASC, "firstName" ASC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    id: r.id,
    bioguideId: r.bioguideId,
    slug: r.slug,
    firstName: r.firstName,
    lastName: r.lastName,
    state: r.state,
    district: r.district,
    party: r.party,
    chamber: r.chamber,
    imageUrl: r.imageUrl,
    link: r.link,
    phone: r.phone,
    matchTier: Number(r.matchTier),
  }));
}

interface RawRepRow {
  id: number;
  bioguideId: string;
  slug: string | null;
  firstName: string;
  lastName: string;
  state: string;
  district: string | null;
  party: string;
  chamber: string;
  imageUrl: string | null;
  link: string | null;
  phone: string | null;
  matchTier: number | bigint;
}
