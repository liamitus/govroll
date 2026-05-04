import { prisma } from "./prisma";

/**
 * Look up representatives by address.
 *
 * Geocoding chain (fail-open to the next provider on any error/no-match):
 *   1. Geocodio — primary. Best US-residential coverage, returns CD directly,
 *      handles PO Boxes, Queens-style hyphenated numbers, and at-large states.
 *   2. US Census `onelineaddress` — free redundancy if Geocodio is down.
 *   3. Photon forward → Census reverse-by-coords — catches addresses Photon
 *      can resolve but Census's forward parser can't (e.g. new developments).
 *
 * Replaces the deprecated Google Civic Information API (shut down April 2025).
 */

interface GeocodingResult {
  state: string; // USPS abbrev, e.g. "NY"
  district: string | null; // house district number as string, or null for at-large/delegate
}

/** Primary: Geocodio with `fields=cd` appended. */
async function geocodeViaGeocodio(
  address: string,
): Promise<GeocodingResult | null> {
  const key = process.env.GEOCODIO_API_KEY;
  if (!key) return null;

  try {
    const url =
      `https://api.geocod.io/v1.9/geocode` +
      `?q=${encodeURIComponent(address)}&fields=cd&limit=1&api_key=${key}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      results?: Array<{
        accuracy?: number;
        accuracy_type?: string;
        address_components?: { state?: string };
        fields?: {
          congressional_districts?: Array<{
            district_number?: number;
            ocd_id?: string;
          }>;
        };
      }>;
    };

    const result = data.results?.[0];
    const state = result?.address_components?.state;
    if (!state) return null;

    // Reject low-confidence matches. Geocodio will happily return a 0.5-accuracy
    // place-level guess for ambiguous inputs like "2-20 Malt Drive, NY, NY" that
    // lands in a completely wrong city — falling through to the Photon→Census
    // fallback usually produces a correct district in those cases.
    if ((result?.accuracy ?? 0) < 0.8) return null;

    const cd = result?.fields?.congressional_districts?.[0];
    // At-large voting seats use district_number 0; non-voting delegate seats
    // (DC, PR, territories) use 98. In both cases our DB stores district=null.
    const isAtLarge =
      !cd ||
      cd.district_number === 0 ||
      cd.district_number === 98 ||
      (cd.ocd_id?.includes("cd:at-large") ?? false);

    return {
      state,
      district: isAtLarge ? null : String(cd.district_number),
    };
  } catch (error) {
    console.error("Geocodio lookup failed:", error);
    return null;
  }
}

/** Fallback 1: US Census Bureau onelineaddress geocoder. */
async function geocodeViaCensus(
  address: string,
): Promise<GeocodingResult | null> {
  try {
    const encoded = encodeURIComponent(address);
    const url = `https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=${encoded}&benchmark=Public_AR_Current&vintage=Current_Current&layers=54&format=json`;

    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;

    const data = await res.json();
    const match = data?.result?.addressMatches?.[0];
    if (!match) return null;

    const state = match.addressComponents?.state || "";
    if (!state) return null;

    const district = extractCdFromCensusGeographies(match.geographies);
    return { state, district };
  } catch (error) {
    console.error("Census geocoding failed:", error);
    return null;
  }
}

/**
 * Fallback 2: Photon forward geocode → Census reverse-by-coords.
 * Handles addresses Census's forward parser rejects (e.g. some LIC hyphenated
 * house numbers) but Photon/OSM can resolve to a rooftop coordinate.
 */
async function geocodeViaPhotonCensusReverse(
  address: string,
): Promise<GeocodingResult | null> {
  try {
    const params = new URLSearchParams({
      q: address,
      limit: "1",
      lang: "en",
      lat: "39.8",
      lon: "-98.5",
    });
    const photonRes = await fetch(
      `https://photon.komoot.io/api/?${params}&layer=house&layer=street`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!photonRes.ok) return null;

    const photonData = (await photonRes.json()) as {
      features?: Array<{
        geometry?: { coordinates?: [number, number] };
        properties?: { countrycode?: string };
      }>;
    };

    const feature = photonData.features?.[0];
    if (feature?.properties?.countrycode?.toLowerCase() !== "us") return null;
    const coords = feature.geometry?.coordinates;
    if (!coords) return null;
    const [lon, lat] = coords;

    const censusRes = await fetch(
      `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lon}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=54&format=json`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!censusRes.ok) return null;

    const censusData = await censusRes.json();
    const geographies = censusData?.result?.geographies;
    if (!geographies) return null;

    const fipsKey = Object.keys(geographies).find((k) =>
      k.toLowerCase().includes("congressional"),
    );
    const fips = fipsKey ? geographies[fipsKey]?.[0]?.STATE : null;
    const state = fips ? FIPS_TO_STATE[fips] : null;
    if (!state) return null;

    const district = extractCdFromCensusGeographies(geographies);
    return { state, district };
  } catch (error) {
    console.error("Photon → Census reverse failed:", error);
    return null;
  }
}

/** Pull the CD number out of a Census `geographies` object. */
function extractCdFromCensusGeographies(
  geographies:
    | Record<string, Array<Record<string, unknown>>>
    | null
    | undefined,
): string | null {
  if (!geographies) return null;
  const key = Object.keys(geographies).find((k) =>
    k.toLowerCase().includes("congressional"),
  );
  if (!key) return null;
  const entry = geographies[key]?.[0];
  if (!entry) return null;
  // `CD` on forward geocodes, `BASENAME` on reverse geocodes, `CD119` etc. as fallback.
  const cd119 = Object.keys(entry).find((k) => /^CD\d+$/.test(k));
  const raw =
    (entry.CD as string | undefined) ??
    (entry.BASENAME as string | undefined) ??
    (cd119 ? (entry[cd119] as string | undefined) : undefined);
  if (!raw || raw === "ZZ") return null;
  const n = parseInt(raw as string, 10);
  if (!Number.isFinite(n) || n === 0) return null;
  return String(n);
}

async function geocodeAddress(
  address: string,
): Promise<GeocodingResult | null> {
  return (
    (await geocodeViaGeocodio(address)) ??
    (await geocodeViaCensus(address)) ??
    (await geocodeViaPhotonCensusReverse(address))
  );
}

/** USPS state/territory abbreviations keyed by Census FIPS code. */
const FIPS_TO_STATE: Record<string, string> = {
  "01": "AL",
  "02": "AK",
  "04": "AZ",
  "05": "AR",
  "06": "CA",
  "08": "CO",
  "09": "CT",
  "10": "DE",
  "11": "DC",
  "12": "FL",
  "13": "GA",
  "15": "HI",
  "16": "ID",
  "17": "IL",
  "18": "IN",
  "19": "IA",
  "20": "KS",
  "21": "KY",
  "22": "LA",
  "23": "ME",
  "24": "MD",
  "25": "MA",
  "26": "MI",
  "27": "MN",
  "28": "MS",
  "29": "MO",
  "30": "MT",
  "31": "NE",
  "32": "NV",
  "33": "NH",
  "34": "NJ",
  "35": "NM",
  "36": "NY",
  "37": "NC",
  "38": "ND",
  "39": "OH",
  "40": "OK",
  "41": "OR",
  "42": "PA",
  "44": "RI",
  "45": "SC",
  "46": "SD",
  "47": "TN",
  "48": "TX",
  "49": "UT",
  "50": "VT",
  "51": "VA",
  "53": "WA",
  "54": "WV",
  "55": "WI",
  "56": "WY",
  "60": "AS",
  "66": "GU",
  "69": "MP",
  "72": "PR",
  "78": "VI",
};

/**
 * Get representatives for an address from our database.
 *
 * Returns `null` when none of the geocoders can resolve the address — this is
 * a user-input failure (typo, PO box none of the providers know, etc.) and
 * should be surfaced as a 400 by callers, not alerted on as a 500.
 */
export async function getRepresentativesByAddress(address: string) {
  const geo = await geocodeAddress(address);
  if (!geo) return null;

  // Find senators for the state (always 2)
  const senators = await prisma.representative.findMany({
    where: {
      state: geo.state,
      chamber: "senator",
    },
  });

  // Find house representative for the district
  const houseReps = geo.district
    ? await prisma.representative.findMany({
        where: {
          state: geo.state,
          district: geo.district,
          chamber: "representative",
        },
      })
    : [];

  // If district lookup didn't work, get all reps for the state as fallback.
  // This also covers at-large states/territories (district stored as null in DB):
  // AK, DE, ND, SD, VT, WY, plus DC and territory delegates.
  const allReps =
    houseReps.length === 0
      ? await prisma.representative.findMany({
          where: {
            state: geo.state,
            chamber: "representative",
          },
        })
      : [];

  const officials = [
    ...senators.map((s) => ({
      name: `${s.firstName} ${s.lastName}`,
      party: s.party,
      bioguideId: s.bioguideId,
      slug: s.slug,
      chamber: "senator",
      photoUrl: s.imageUrl,
      state: s.state,
      district: null,
      firstName: s.firstName,
      lastName: s.lastName,
      imageUrl: s.imageUrl,
      link: s.link,
      phone: s.phone,
      id: s.id,
    })),
    ...(houseReps.length > 0
      ? houseReps
      : allReps.length <= 3
        ? allReps
        : []
    ).map((r) => ({
      name: `${r.firstName} ${r.lastName}`,
      party: r.party,
      bioguideId: r.bioguideId,
      slug: r.slug,
      chamber: "representative",
      photoUrl: r.imageUrl,
      state: r.state,
      district: r.district,
      firstName: r.firstName,
      lastName: r.lastName,
      imageUrl: r.imageUrl,
      link: r.link,
      phone: r.phone,
      id: r.id,
    })),
  ];

  return { officials, state: geo.state, district: geo.district };
}
