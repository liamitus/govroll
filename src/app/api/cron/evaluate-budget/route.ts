import { NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/timing-safe-equal";
import { evaluateAiEnabled } from "@/lib/budget";
import { invalidateAiGateCache } from "@/lib/ai-gate";
import { reportError } from "@/lib/error-reporting";

/**
 * Hourly cron, invoked by the GitHub Actions `ingest` workflow (see
 * `.github/workflows/ingest.yml`). Recomputes `aiEnabled` for the current
 * period and invalidates the in-process gate cache on this instance (other
 * serverless instances pick up the change on their own TTL expiry).
 *
 * This is the backstop that re-enables AI once fresh income restores the
 * budget. The fast *disable* path lives in `recordSpend`, which flips the flag
 * the instant a spend tips the period negative rather than waiting for this.
 *
 * Protected by `CRON_SECRET` — the workflow sends it as a Bearer token.
 */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("CRON_SECRET is not configured");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const auth = request.headers.get("authorization");
  if (!timingSafeEqualStr(auth, `Bearer ${expected}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const snapshot = await evaluateAiEnabled();
    invalidateAiGateCache();

    return NextResponse.json({
      ok: true,
      period: snapshot.period,
      aiEnabled: snapshot.aiEnabled,
      carryoverCents: snapshot.carryoverCents,
      incomeCents: snapshot.incomeCents,
      spendCents: snapshot.spendCents,
      reserveCents: snapshot.reserveCents,
      availableCents: snapshot.availableCents,
      evaluatedAt: new Date().toISOString(),
    });
  } catch (error) {
    await reportError(error, { cron: "evaluate-budget" });
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
