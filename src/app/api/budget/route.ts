import { NextResponse } from "next/server";
import { getBudgetSnapshot, getTypicalDonationCents } from "@/lib/budget";

/**
 * GET /api/budget
 *
 * Public endpoint returning the current month's budget snapshot for the
 * donate page thermometer and AI-status indicator. No auth required —
 * radical transparency is the fundraising pitch.
 */
export async function GET() {
  const [snapshot, typicalCents] = await Promise.all([
    getBudgetSnapshot(),
    getTypicalDonationCents(),
  ]);

  return NextResponse.json({
    period: snapshot.period,
    carryoverCents: snapshot.carryoverCents,
    incomeCents: snapshot.incomeCents,
    spendCents: snapshot.spendCents,
    aiEnabled: snapshot.aiEnabled,
    typicalDonationCents: typicalCents,
  });
}
