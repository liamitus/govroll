/**
 * Client-side query helpers for representative lookups. Address-indexed
 * queries benefit from TanStack's cache: repeated visits to /bills with
 * the same address hit the cache (staleTime: 30s) instead of re-fetching.
 */

export interface RepByAddress {
  name: string;
  party: string;
  bioguideId: string;
  slug: string | null;
  chamber: string;
  state: string;
  district: string | null;
  firstName: string;
  lastName: string;
  imageUrl: string | null;
  phone: string | null;
}

export function repsByAddressQueryKey(address: string) {
  return ["reps-by-address", address] as const;
}

export async function fetchRepsByAddress(
  address: string,
  signal?: AbortSignal,
): Promise<RepByAddress[]> {
  const res = await fetch("/api/representatives/by-address", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`Rep lookup failed (${res.status})`);
  }
  const data = await res.json();
  return data.representatives ?? [];
}

export function repsForBillQueryKey(billId: number, address: string) {
  return ["reps-for-bill", billId, address] as const;
}

export interface RepsForBillResult {
  representatives: unknown[];
  chamberPassage: unknown[];
  /** bioguideId of the sponsor when known. Lets the rep card label the
   * sponsor's row "Sponsored this bill" instead of treating the sponsor
   * like any other rep with no roll-call vote. */
  sponsorBioguideId: string | null;
  /** ISO date the bill was introduced — used to date the sponsorship
   * caption on the matching rep card. */
  introducedDate: string | null;
}

export async function fetchRepsForBill(
  billId: number,
  address: string,
  signal?: AbortSignal,
): Promise<RepsForBillResult> {
  const res = await fetch("/api/representatives", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, billId }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`Rep-for-bill lookup failed (${res.status})`);
  }
  const data = await res.json();
  return {
    representatives: data.representatives ?? [],
    chamberPassage: data.chamberPassage ?? [],
    sponsorBioguideId: data.sponsorBioguideId ?? null,
    introducedDate: data.introducedDate ?? null,
  };
}
