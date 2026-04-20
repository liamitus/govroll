import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const page = parseInt(request.nextUrl.searchParams.get("page") || "1");
  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "20");
  const skip = (page - 1) * limit;

  try {
    const [total, comments, voteSums] = await Promise.all([
      prisma.comment.count({ where: { userId } }),
      prisma.comment.findMany({
        where: { userId },
        include: {
          bill: { select: { id: true, billId: true, title: true } },
        },
        orderBy: { date: "desc" },
        skip,
        take: limit,
      }),
      prisma.commentVote.groupBy({
        by: ["commentId"],
        where: { comment: { userId } },
        _sum: { voteType: true },
      }),
    ]);

    const voteMap = new Map<number, number>();
    for (const v of voteSums) {
      voteMap.set(v.commentId, v._sum.voteType || 0);
    }

    const commentsWithVoteCounts = comments.map((comment) => ({
      ...comment,
      voteCount: voteMap.get(comment.id) || 0,
    }));

    return NextResponse.json({ comments: commentsWithVoteCounts, total });
  } catch (error) {
    console.error("Error fetching user comments:", error);
    return NextResponse.json(
      { error: "Failed to fetch user comments" },
      { status: 500 },
    );
  }
}
