import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { reportError } from "@/lib/error-reporting";

/**
 * Daily cron. Sweeps expired `AiResponseCache` rows.
 *
 * The cache is read-through with an `expiresAt` guard, so stale rows are
 * already ignored at read time — but they were only ever *deleted* lazily,
 * on an exact (billId, promptHash) re-hit. Prompts that never recur (the
 * common case) therefore accumulated forever, growing the table and its
 * unique index unbounded. This sweep reclaims them via the existing
 * `AiResponseCache_expiresAt_idx`. It's idempotent — re-running deletes
 * nothing once caught up — so an occasional missed/overlapping run is fine.
 *
 * Protected by `CRON_SECRET`; GitHub Actions (`ingest.yml`) sends it in the
 * Authorization header.
 */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("CRON_SECRET is not configured");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { count } = await prisma.aiResponseCache.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });

    return NextResponse.json({
      ok: true,
      deleted: count,
      sweptAt: new Date().toISOString(),
    });
  } catch (error) {
    await reportError(error, { cron: "cleanup-expired-cache" });
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
