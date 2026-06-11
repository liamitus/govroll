import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison for secrets/tokens (CRON_SECRET, ADMIN_API_KEY).
 *
 * Hashing both inputs to a fixed 32-byte digest first means the comparison
 * runs in constant time regardless of input length and never leaks length via
 * an early return — and `timingSafeEqual` can't throw on a length mismatch.
 * Returns false for null/undefined so callers can pass a possibly-missing
 * request header directly.
 */
export function timingSafeEqualStr(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (a == null || b == null) return false;
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
