import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ billId: string }> },
) {
  const { billId } = await params;
  const id = parseInt(billId);

  try {
    const passageCategories = [
      "passage",
      "passage_suspension",
      "veto_override",
    ];

    const [publicVotes, passageVotes, latestVersion] = await Promise.all([
      prisma.vote.groupBy({
        by: ["voteType"],
        where: { billId: id },
        _count: { voteType: true },
      }),
      // Get passage roll call votes (not amendments/procedural)
      prisma.representativeVote.findMany({
        where: {
          billId: id,
          category: { in: passageCategories },
        },
        select: {
          vote: true,
          rollCallNumber: true,
          chamber: true,
          votedAt: true,
          category: true,
        },
      }),
      prisma.billTextVersion.findFirst({
        where: { billId: id },
        orderBy: { versionDate: "desc" },
        select: {
          id: true,
          versionCode: true,
          versionType: true,
          versionDate: true,
        },
      }),
    ]);

    // Fall back to all votes if no passage-categorized votes found
    const congressionalVotes =
      passageVotes.length > 0
        ? passageVotes
        : await prisma.representativeVote.findMany({
            where: { billId: id },
            select: {
              vote: true,
              rollCallNumber: true,
              chamber: true,
              votedAt: true,
              category: true,
            },
          });

    // Group congressional votes by roll call
    const rollCallMap = new Map<
      string,
      {
        rollCallNumber: number | null;
        chamber: string | null;
        votedAt: Date | null;
        category: string | null;
        votes: Record<string, number>;
      }
    >();

    for (const cv of congressionalVotes) {
      const key =
        cv.rollCallNumber != null
          ? `${cv.chamber}-${cv.rollCallNumber}`
          : "legacy";
      if (!rollCallMap.has(key)) {
        rollCallMap.set(key, {
          rollCallNumber: cv.rollCallNumber,
          chamber: cv.chamber,
          votedAt: cv.votedAt,
          // Every rep vote in one roll call shares its category; the card
          // needs it to pick the right pass/fail threshold.
          category: cv.category,
          votes: {},
        });
      }
      const group = rollCallMap.get(key)!;
      group.votes[cv.vote] = (group.votes[cv.vote] || 0) + 1;
    }

    // Sort roll calls by date (most recent first)
    const rollCalls = Array.from(rollCallMap.values())
      .sort((a, b) => {
        if (!a.votedAt || !b.votedAt) return 0;
        return b.votedAt.getTime() - a.votedAt.getTime();
      })
      .map((rc) => ({
        rollCallNumber: rc.rollCallNumber,
        chamber: rc.chamber,
        votedAt: rc.votedAt?.toISOString() || null,
        category: rc.category,
        votes: Object.entries(rc.votes).map(([vote, count]) => ({
          vote,
          count,
        })),
      }));

    // Also provide the flat aggregation for backward compat
    const allCongressionalVotes: Record<string, number> = {};
    for (const cv of congressionalVotes) {
      allCongressionalVotes[cv.vote] =
        (allCongressionalVotes[cv.vote] || 0) + 1;
    }

    return NextResponse.json({
      publicVotes: publicVotes.map((v) => ({
        voteType: v.voteType,
        count: v._count.voteType,
      })),
      congressionalVotes: Object.entries(allCongressionalVotes).map(
        ([vote, count]) => ({
          vote,
          count,
        }),
      ),
      rollCalls,
      latestVersion: latestVersion
        ? {
            id: latestVersion.id,
            versionCode: latestVersion.versionCode,
            versionType: latestVersion.versionType,
            versionDate: latestVersion.versionDate,
          }
        : null,
    });
  } catch (error) {
    console.error("Error fetching votes:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
