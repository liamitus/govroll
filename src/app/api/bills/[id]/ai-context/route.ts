import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/bills/:id/ai-context
 *
 * Lightweight probe — does this bill have text the AI can quote from?
 * The chatbox calls this on mount so it can set expectations BEFORE the
 * user types a question, rather than having the AI dutifully answer from
 * the title and then confess at the bottom.
 *
 * Returns:
 *   { hasFullText: boolean, hasShortText: boolean, tier: "full"|"summary"|"title-only" }
 *
 * Caches 5 minutes at the edge — text availability rarely changes.
 */
export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const billId = parseInt(id, 10);
  if (!Number.isFinite(billId)) {
    return NextResponse.json({ error: "Invalid bill id" }, { status: 400 });
  }

  // Boolean indicators only — never select fullText/shortText itself.
  // Selecting fullText would ship megabytes per request when uncached at
  // the edge. Each count() below is a fast indexed PK lookup returning a
  // single integer.
  const [bill, billHasFullText, billHasShortText, versionHasFullText] =
    await Promise.all([
      prisma.bill.findUnique({
        where: { id: billId },
        select: { id: true },
      }),
      prisma.bill.count({
        where: { id: billId, fullText: { not: null } },
      }),
      prisma.bill.count({
        where: { id: billId, shortText: { not: null } },
      }),
      prisma.billTextVersion.count({
        where: { billId, fullText: { not: null } },
      }),
    ]);

  if (!bill) {
    return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  }

  const hasFullText = billHasFullText > 0 || versionHasFullText > 0;
  const hasShortText = billHasShortText > 0;

  const tier: "full" | "summary" | "title-only" = hasFullText
    ? "full"
    : hasShortText
      ? "summary"
      : "title-only";

  return NextResponse.json(
    { hasFullText, hasShortText, tier },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    },
  );
}
