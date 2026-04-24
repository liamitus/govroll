import { NextResponse } from "next/server";
import { after } from "next/server";
import {
  ensureSummaryJob,
  generateSummaryForVersion,
} from "@/lib/bill-summary";

/**
 * POST /api/bills/[id]/summary
 *
 * Idempotently ensures an AI change-summary exists (or is being generated)
 * for the latest substantive version of the given bill. On first call this
 * kicks off generation via `after()` — the response returns immediately
 * (`status: "pending"`) while Fluid Compute finishes the AI call in the
 * background. Subsequent calls are safe, cheap status-polls.
 *
 * Response shapes:
 *   { status: "ready",    summary, versionCode, versionType, versionDate }
 *   { status: "pending",  versionCode, versionType, versionDate, startedAt }
 *   { status: "disabled", reason: "budget" | "manual" }
 *   { status: "error",    error, versionCode, versionType, versionDate }
 *   { status: "none" }  — bill has no substantive version
 *
 * Public: no auth required. The work is budget-gated at the AI layer, and
 * job dedup means repeated polls don't cost anything after the first.
 */

export const maxDuration = 60;

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const billId = parseInt(id, 10);
  if (Number.isNaN(billId)) {
    return NextResponse.json(
      { status: "error", error: "invalid bill id" },
      { status: 400 },
    );
  }

  const outcome = await ensureSummaryJob(billId);

  if (outcome.started) {
    // Fire-and-forget generation; response returns to the client while the
    // Fluid instance keeps the handle alive. If the instance crashes mid-run
    // the STALE_PENDING_MS fallback lets the next caller retry.
    after(generateSummaryForVersion(outcome.versionId));
  }

  return NextResponse.json(outcome.state);
}

// GET mirrors POST — some clients (browser prefetch, link sharing) will GET
// the URL. Behaving identically means we don't show a stale summary just
// because the caller chose a different verb.
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return POST(request, context);
}
