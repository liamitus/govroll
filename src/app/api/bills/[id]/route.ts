import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { reportError } from "@/lib/error-reporting";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const billId = parseInt(id);

  try {
    // Public endpoint with no internal callers — kept for backwards
    // compatibility with any external consumers. We omit fullText and
    // searchVector from the response: shipping legislative text on every
    // GET balloons egress (each bill row can be megabytes), and the
    // tsvector column isn't useful over the wire anyway.
    const bill = await prisma.bill.findUnique({
      where: { id: billId },
      select: {
        id: true,
        billId: true,
        title: true,
        date: true,
        billType: true,
        currentChamber: true,
        currentStatus: true,
        currentStatusDate: true,
        introducedDate: true,
        link: true,
        shortText: true,
        sponsor: true,
        cosponsorCount: true,
        cosponsorPartySplit: true,
        policyArea: true,
        latestActionText: true,
        latestActionDate: true,
        congressNumber: true,
        momentumScore: true,
        momentumTier: true,
        daysSinceLastAction: true,
        deathReason: true,
        momentumComputedAt: true,
        latestMajorActionDate: true,
        hasImminentFloorAction: true,
        lastMetadataRefreshAt: true,
        textFetchAttemptedAt: true,
        popularTitle: true,
        shortTitle: true,
        displayTitle: true,
        aiShortDescription: true,
        aiKeyPoints: true,
        aiSummaryModel: true,
        aiSummaryCreatedAt: true,
        aiSummaryVersionId: true,
      },
    });

    if (!bill) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    }

    return NextResponse.json(bill);
  } catch (error) {
    console.error("Error fetching bill:", error);
    reportError(error, { route: "GET /api/bills/[id]", billId });
    return NextResponse.json(
      { error: "Failed to fetch bill" },
      { status: 500 },
    );
  }
}
