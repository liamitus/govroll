import { NextResponse } from "next/server";
import { evaluateAiEnabled } from "@/lib/budget";
import { invalidateAiGateCache } from "@/lib/ai-gate";
import { reportError } from "@/lib/error-reporting";

/**
 * Hourly Vercel cron. Recomputes `aiEnabled` for the current period and
 * invalidates the in-process gate cache on this instance (other serverless
 * instances will pick up the change on their own TTL expiry).
 *
 * Protected by `CRON_SECRET` — Vercel cron invocations include the secret in
 * the Authorization header automatically when configured in project settings.
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
