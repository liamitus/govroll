/**
 * Parse and clamp pagination query params so user-supplied values can't flow
 * unbounded into Prisma `take`/`skip`. An unclamped `?limit=` lets a caller
 * request an arbitrarily large page; an invalid/negative `?page=` produces a
 * negative skip.
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function clampLimit(
  raw: string | null,
  fallback = DEFAULT_LIMIT,
  max = MAX_LIMIT,
): number {
  const n = parseInt(raw ?? "", 10);
  if (Number.isNaN(n) || n < 1) return fallback;
  return Math.min(n, max);
}

export function clampPage(raw: string | null): number {
  const n = parseInt(raw ?? "", 10);
  return Number.isNaN(n) || n < 1 ? 1 : n;
}
