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

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function fetchRepresentativesFunction() {
  try {
    const roles = await fetchGovTrackRoles({ current: true, limit: 600 });

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

      await prisma.representative.upsert({
        where: { bioguideId },
        update: {
          firstName: person.firstname,
          lastName: person.lastname,
          state: role.state,
          district,
          party: role.party,
          chamber,
          imageUrl,
          link: person.link,
          termEnd: role.enddate ? new Date(role.enddate) : null,
        },
        create: {
          bioguideId,
          slug: nameToSlug(person.firstname, person.lastname),
          firstName: person.firstname,
          lastName: person.lastname,
          state: role.state,
          district,
          party: role.party,
          chamber,
          imageUrl,
          link: person.link,
          termEnd: role.enddate ? new Date(role.enddate) : null,
        },
      });
    }
    console.log("Representatives fetched and stored successfully.");
  } catch (error: any) {
    console.error("Error fetching representatives:", error.message);
  } finally {
    await prisma.$disconnect();
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

if (require.main === module) {
  fetchRepresentativesFunction();
}
