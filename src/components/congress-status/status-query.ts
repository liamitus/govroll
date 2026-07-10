import type { CongressStatusResponse } from "@/app/api/congress/status/route";

/**
 * Shared React Query key + fetcher for /api/congress/status, used by both
 * the NavBar pill (which polls) and the feed's RecessNotice (which just
 * reads the shared cache). Keeping them on one key means the notice never
 * issues a second request while the pill is polling.
 */

export const CONGRESS_STATUS_QUERY_KEY = ["congress-status"] as const;

export async function fetchCongressStatus(): Promise<CongressStatusResponse> {
  const res = await fetch("/api/congress/status", { cache: "no-store" });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}
