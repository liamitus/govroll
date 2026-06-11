/**
 * DB-backed per-user rate limiting for AI endpoints.
 *
 * Uses the existing AiUsageEvent table to count recent requests — no Redis or
 * new infrastructure required. Because the count is in Postgres, limits persist
 * across serverless cold starts and concurrent instances.
 */

import { prisma } from "@/lib/prisma";

export class RateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(limitName: string, retryAfterSeconds: number) {
    super(`Rate limit exceeded: ${limitName}`);
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }

  toJSON() {
    return {
      error: "rate_limited",
      message: this.message,
      retryAfterSeconds: this.retryAfterSeconds,
    };
  }
}

/**
 * Assert that the user hasn't blown a daily cost cap on a given AI feature.
 * Sums recorded `costCents` from `AiUsageEvent` over the trailing 24 hours
 * and throws `RateLimitError` once they exceed the cap.
 *
 * Distinct from `assertUserRateLimit` (which counts requests): a single
 * omnibus-bill chat is many times more expensive than a small-bill chat,
 * so a cents-based cap bounds blast radius better than a request count.
 * Used as a backstop against an attacker (or a curious power user)
 * specifically targeting expensive bills.
 */
export async function assertUserDailyCostCap(
  userId: string,
  feature: string,
  maxCentsPerDay: number,
): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await prisma.aiUsageEvent.aggregate({
    where: {
      userId,
      feature,
      createdAt: { gte: since },
    },
    _sum: { costCents: true },
  });
  const totalCents = result._sum.costCents ?? 0;
  if (totalCents >= maxCentsPerDay) {
    throw new RateLimitError(
      `${(maxCentsPerDay / 100).toFixed(2)} USD ${feature} cost per day`,
      // The 24h window slides; the cap effectively unblocks once the oldest
      // event drops out, but we don't compute that exactly. An hour is a
      // reasonable hint that they should come back later.
      3600,
    );
  }
}

/**
 * Assert that the user hasn't exceeded their per-hour request limit for a
 * given AI feature. Throws `RateLimitError` if exceeded.
 */
export async function assertUserRateLimit(
  userId: string,
  feature: string,
  maxPerHour: number,
): Promise<void> {
  const windowMs = 60 * 60 * 1000;
  const oneHourAgo = new Date(Date.now() - windowMs);

  const count = await prisma.aiUsageEvent.count({
    where: {
      userId,
      feature,
      createdAt: { gte: oneHourAgo },
    },
  });

  if (count >= maxPerHour) {
    // The trailing window unblocks once the oldest counted event ages out, so
    // derive the wait from its timestamp. (The previous formula reduced to
    // `60 - 60 ≈ 0`, so clients were always told to retry immediately.)
    // Only the rare limit-exceeded path pays for this second query.
    const oldest = await prisma.aiUsageEvent.findFirst({
      where: { userId, feature, createdAt: { gte: oneHourAgo } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    const retryAfterSeconds = oldest
      ? Math.max(
          1,
          Math.ceil(
            (oldest.createdAt.getTime() + windowMs - Date.now()) / 1000,
          ),
        )
      : 60;
    throw new RateLimitError(
      `${maxPerHour} ${feature} requests per hour`,
      retryAfterSeconds,
    );
  }
}

/**
 * Assert that the user hasn't exceeded their per-hour comment-posting cap.
 *
 * Counts real `Comment` rows by `userId` — deliberately decoupled from the
 * AI/moderation spend ledger. The previous comment cap reused
 * `assertUserRateLimit(userId, "moderation_content", …)`, which counts
 * `AiUsageEvent` rows; but those events are written without a userId (see
 * `recordSpend` in `@/lib/budget`), so the per-user count was always 0 and the
 * cap never tripped. Counting comments directly is correct regardless of
 * whether moderation ran, and it's the thing we actually want to bound.
 */
export async function assertUserCommentRateLimit(
  userId: string,
  maxPerHour: number,
): Promise<void> {
  const windowMs = 60 * 60 * 1000;
  const since = new Date(Date.now() - windowMs);

  // Oldest-first, bounded to the cap: if `maxPerHour` rows come back the user
  // is at the limit, and `recent[0]` is the oldest counted comment — the one
  // whose expiry from the trailing window frees the next slot.
  const recent = await prisma.comment.findMany({
    where: { userId, date: { gte: since } },
    orderBy: { date: "asc" },
    take: maxPerHour,
    select: { date: true },
  });

  if (recent.length >= maxPerHour) {
    const oldest = recent[0].date.getTime();
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((oldest + windowMs - Date.now()) / 1000),
    );
    throw new RateLimitError(
      `${maxPerHour} comments per hour`,
      retryAfterSeconds,
    );
  }
}

/**
 * Assert that a given feature hasn't exceeded a global daily call limit.
 * Useful for endpoints like moderation where per-user doesn't apply.
 */
export async function assertGlobalDailyLimit(
  feature: string,
  maxPerDay: number,
): Promise<void> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const count = await prisma.aiUsageEvent.count({
    where: {
      feature,
      createdAt: { gte: todayStart },
    },
  });

  if (count >= maxPerDay) {
    throw new RateLimitError(`${maxPerDay} ${feature} calls per day`, 3600);
  }
}

/**
 * Assert that an IP hasn't exceeded the hourly limit for a feature.
 * For endpoints where auth isn't required (e.g. moderation on donations).
 *
 * Uses a lightweight in-process counter as a first pass, then falls back to
 * the global daily limit in the DB. This is intentionally simple — the daily
 * DB check is the real safety net; the IP map is just a fast-reject layer.
 */
const ipCounts = new Map<string, { count: number; resetAt: number }>();

/**
 * Best-effort client IP from the `x-forwarded-for` chain. On Vercel the
 * platform sets this header; the left-most entry is the originating client.
 * Falls back to "unknown" so an unparseable request still shares a single
 * rate-limit bucket rather than slipping the guard entirely.
 */
export function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  );
}

export function assertIpRateLimit(ip: string, maxPerHour: number): void {
  const now = Date.now();
  const entry = ipCounts.get(ip);
  if (!entry || now > entry.resetAt) {
    ipCounts.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return;
  }
  if (entry.count >= maxPerHour) {
    throw new RateLimitError(
      `${maxPerHour} requests per hour per IP`,
      Math.ceil((entry.resetAt - now) / 1000),
    );
  }
  entry.count++;
}
