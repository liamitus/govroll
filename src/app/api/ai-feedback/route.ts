import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { reportError } from "@/lib/error-reporting";
import { assertIpRateLimit, RateLimitError } from "@/lib/rate-limit";

const SURFACES = ["explainer", "change_summary"] as const;
type Surface = (typeof SURFACES)[number];

const FEEDBACK_PER_IP_PER_HOUR = 60;

function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  );
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const { billId, surface, rating } = (body ?? {}) as {
    billId?: unknown;
    surface?: unknown;
    rating?: unknown;
  };

  if (
    typeof billId !== "number" ||
    !Number.isInteger(billId) ||
    typeof surface !== "string" ||
    !SURFACES.includes(surface as Surface) ||
    (rating !== 1 && rating !== -1)
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    assertIpRateLimit(clientIp(request), FEEDBACK_PER_IP_PER_HOUR);
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(err.toJSON(), {
        status: 429,
        headers: { "Retry-After": String(err.retryAfterSeconds) },
      });
    }
    throw err;
  }

  try {
    const bill = await prisma.bill.findUnique({
      where: { id: billId },
      select: { id: true, aiSummaryModel: true, aiSummaryVersionId: true },
    });
    if (!bill) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    }

    await prisma.aiSummaryFeedback.create({
      data: {
        billId: bill.id,
        surface,
        aiSummaryModel: bill.aiSummaryModel,
        aiSummaryVersionId: bill.aiSummaryVersionId,
        rating,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Error submitting AI feedback:", err);
    reportError(err, { route: "POST /api/ai-feedback" });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
