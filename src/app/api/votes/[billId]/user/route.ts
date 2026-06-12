import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUserId } from "@/lib/auth";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ billId: string }> },
) {
  const { userId, error } = await getAuthenticatedUserId();
  if (error) return error;

  const { billId } = await params;
  const id = parseInt(billId);

  try {
    const [vote, latestVersion, voteHistory] = await Promise.all([
      prisma.vote.findUnique({
        where: { userId_billId: { userId, billId: id } },
        include: {
          textVersion: {
            select: {
              id: true,
              versionCode: true,
              versionType: true,
              versionDate: true,
            },
          },
        },
      }),
      prisma.billTextVersion.findFirst({
        where: { billId: id },
        // Match the write side's deterministic ordering (votes/route.ts)
        // so both ends agree on "latest" and the isStale banner is stable
        // across same-day versions that share a versionDate.
        orderBy: [{ versionDate: "desc" }, { id: "desc" }],
        select: {
          id: true,
          versionCode: true,
          versionType: true,
          versionDate: true,
          changeSummary: true,
          isSubstantive: true,
        },
      }),
      prisma.voteHistory.findMany({
        where: { userId, billId: id },
        orderBy: { createdAt: "desc" },
        include: {
          textVersion: {
            select: { versionCode: true, versionType: true },
          },
        },
      }),
    ]);

    // Determine staleness
    let isStale = false;
    let staleInfo = null;

    if (vote && latestVersion) {
      if (vote.textVersionId === null) {
        // Pre-versioning vote — any version existing makes it stale
        isStale = true;
      } else if (vote.textVersionId !== latestVersion.id) {
        // Vote was on an older version — check if any newer SUBSTANTIVE version exists
        const newerSubstantive = await prisma.billTextVersion.findFirst({
          where: {
            billId: id,
            isSubstantive: true,
            versionDate: { gt: vote.textVersion!.versionDate },
          },
          orderBy: { versionDate: "desc" },
        });
        isStale = !!newerSubstantive;
      }

      if (isStale) {
        staleInfo = {
          votedOnVersion: vote.textVersion
            ? {
                versionCode: vote.textVersion.versionCode,
                versionType: vote.textVersion.versionType,
                versionDate: vote.textVersion.versionDate,
              }
            : null,
          currentVersion: {
            versionCode: latestVersion.versionCode,
            versionType: latestVersion.versionType,
            versionDate: latestVersion.versionDate,
          },
          changeSummary: latestVersion.changeSummary,
        };
      }
    }

    return NextResponse.json({
      vote: vote
        ? {
            voteType: vote.voteType,
            textVersionId: vote.textVersionId,
            votedAt: vote.votedAt,
          }
        : null,
      isStale,
      staleInfo,
      voteHistory: voteHistory.map((h) => ({
        voteType: h.voteType,
        createdAt: h.createdAt,
        versionCode: h.textVersion?.versionCode ?? null,
        versionType: h.textVersion?.versionType ?? null,
      })),
    });
  } catch (error) {
    console.error("Error fetching user vote:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
