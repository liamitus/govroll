import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUserId } from "@/lib/auth";
import { reportError } from "@/lib/error-reporting";

export async function POST(request: NextRequest) {
  const { userId, error } = await getAuthenticatedUserId();
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }
  const { billId, voteType } = body;

  if (!billId || !voteType) {
    return NextResponse.json(
      { error: "billId and voteType are required" },
      { status: 400 },
    );
  }

  if (!["For", "Against", "Abstain"].includes(voteType)) {
    return NextResponse.json({ error: "Invalid voteType" }, { status: 400 });
  }

  try {
    // Existence check only — no fullText (multi-MB per row).
    const bill = await prisma.bill.findUnique({
      where: { id: billId },
      select: { id: true },
    });
    if (!bill) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    }

    // Find the latest text version for this bill
    const latestVersion = await prisma.billTextVersion.findFirst({
      where: { billId },
      orderBy: { versionDate: "desc" },
    });

    const [vote] = await prisma.$transaction([
      prisma.vote.upsert({
        where: { userId_billId: { userId, billId } },
        update: {
          voteType,
          textVersionId: latestVersion?.id ?? null,
          votedAt: new Date(),
        },
        create: {
          userId,
          billId,
          voteType,
          textVersionId: latestVersion?.id ?? null,
        },
      }),
      prisma.voteHistory.create({
        data: {
          userId,
          billId,
          voteType,
          textVersionId: latestVersion?.id ?? null,
        },
      }),
    ]);

    return NextResponse.json(vote);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "api_error",
        route: "POST /api/votes",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    reportError(error, { route: "POST /api/votes" });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
