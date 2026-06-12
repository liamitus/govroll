import "dotenv/config";
import { fetchGovTrackRoles } from "../lib/govtrack";
import { createStandalonePrisma } from "../lib/prisma-standalone";
import { nameToSlug } from "../lib/slug";

const prisma = createStandalonePrisma();

/**
 * Normalize a GovTrack `role.district` value for storage.
 *
 * GovTrack represents at-large seats (single-district states like SD, VT,
 * WY, AK, DE, ND) as `0`, which the old `role.district ? ... : null`
 * check silently coerced to null — leaving us unable to match those reps
 * by district and giving civic-lookup a false "delegate" fingerprint.
 *
 * Returns:
 *   - null for senators and non-representative roles (no district concept)
 *   - "At Large" for the numeric-zero at-large encoding
 *   - the number as a string otherwise (e.g. "14")
 */
export function normalizeDistrict(
  district: number | string | null | undefined,
  chamber: string,
): string | null {
  if (chamber !== "representative") return null;
  if (district == null) return null;
  if (typeof district === "number") {
    if (district === 0) return "At Large";
    return String(district);
  }
  const trimmed = district.trim();
  if (trimmed === "" || trimmed === "0") return "At Large";
  return trimmed;
}

/**
 * Pick a slug for a brand-new representative that won't trip the unique `slug`
 * constraint. Mirrors backfill-rep-slugs.ts: start from the name-based slug,
 * and when a *different* member already holds it (two same-named reps — e.g.
 * the two Rep. Mike Rogers), disambiguate by state, then by bioguideId as a
 * last resort. Slug is create-only — we never re-slug an existing member — so
 * this runs only on the rare new-member path, where the extra lookups are
 * cheap. Without it, the second same-named member's create threw a unique
 * violation that (pre-fix) aborted the entire weekly sweep.
 */
async function resolveSlugForCreate(
  firstName: string,
  lastName: string,
  state: string,
  bioguideId: string,
): Promise<string> {
  const base = nameToSlug(firstName, lastName);
  const candidates = [
    base,
    `${base}-${state.toLowerCase()}`,
    `${base}-${state.toLowerCase()}-${bioguideId.toLowerCase()}`,
  ];
  for (const slug of candidates) {
    const existing = await prisma.representative.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!existing) return slug;
  }
  // Every candidate is taken (vanishingly unlikely). Return the most-specific
  // one anyway; if even that collides, the per-row catch records it.
  return candidates[candidates.length - 1];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function fetchRepresentativesFunction() {
  try {
    const roles = await fetchGovTrackRoles({ current: true, limit: 600 });

    let processed = 0;
    const errors: Array<{ bioguideId: string; error: string }> = [];

    for (const role of roles) {
      const person = role.person;
      const bioguideId = person.bioguideid;

      if (!bioguideId) {
        console.warn(`No bioguideId for person: ${person.name}`);
        continue;
      }

      const imageUrl = `https://bioguide.congress.gov/bioguide/photo/${bioguideId[0]}/${bioguideId}.jpg`;
      const chamber: string = role.role_type_label.toLowerCase();
      const district = normalizeDistrict(role.district, chamber);

      // Columns shared by create and update. Slug is intentionally absent —
      // it's set once on create (see resolveSlugForCreate) and never rewritten.
      const fields = {
        firstName: person.firstname,
        lastName: person.lastname,
        state: role.state,
        district,
        party: role.party,
        chamber,
        imageUrl,
        link: person.link,
        termEnd: role.enddate ? new Date(role.enddate) : null,
      };

      // Per-row try/catch: one bad member (e.g. a slug unique-collision
      // between two same-named reps on the create path) must NOT abort the
      // whole weekly roster sweep. Log + count it and continue. A run that
      // fails *every* row throws below, so the cron still alerts loudly.
      try {
        const existing = await prisma.representative.findUnique({
          where: { bioguideId },
          select: { id: true },
        });
        if (existing) {
          await prisma.representative.update({
            where: { bioguideId },
            data: fields,
          });
        } else {
          const slug = await resolveSlugForCreate(
            person.firstname,
            person.lastname,
            role.state,
            bioguideId,
          );
          await prisma.representative.create({
            data: { bioguideId, slug, ...fields },
          });
        }
        processed++;
      } catch (rowError: unknown) {
        const msg =
          rowError instanceof Error ? rowError.message : String(rowError);
        console.error(`Failed to upsert representative ${bioguideId}:`, msg);
        errors.push({ bioguideId, error: msg });
      }
    }

    console.log(
      `Representatives: ${processed} upserted, ${errors.length} failed (of ${roles.length} roles).`,
    );

    // Had rows but wrote nothing → the run is broken (DB down, schema drift)
    // even though no exception bubbled out of the loop. Surface it so the
    // route returns 500 + alerts rather than a green success that wrote zero.
    if (roles.length > 0 && processed === 0) {
      throw new Error(
        `fetch-representatives: all ${roles.length} roster rows failed to upsert`,
      );
    }

    return { processed, errorCount: errors.length };
  } catch (error: any) {
    // Systemic failure (GovTrack unreachable, DB down, or all-rows-failed
    // above). Log and re-throw so the cron route surfaces a 500 + reportError
    // instead of laundering the outage into a green {ok:true}.
    console.error("Error fetching representatives:", error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

if (require.main === module) {
  fetchRepresentativesFunction();
}
