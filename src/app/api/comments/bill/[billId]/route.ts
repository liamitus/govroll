import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clampLimit, clampPage } from "@/lib/pagination";

interface CommentWithReplies {
  id: number;
  content: string;
  userId: string | null;
  username: string;
  billId: number;
  parentCommentId: number | null;
  date: Date;
  voteCount: number;
  replies: CommentWithReplies[];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ billId: string }> },
) {
  const { billId } = await params;
  const id = parseInt(billId);
  const page = clampPage(request.nextUrl.searchParams.get("page"));
  const limit = clampLimit(request.nextUrl.searchParams.get("limit"));
  const skip = (page - 1) * limit;
  const sortOption =
    request.nextUrl.searchParams.get("sort") === "best" ? "best" : "new";

  try {
    // 2 queries total — no N+1
    const [allComments, voteSums] = await Promise.all([
      prisma.comment.findMany({
        where: { billId: id },
        include: { profile: { select: { username: true } } },
        orderBy: { date: "desc" },
      }),
      prisma.commentVote.groupBy({
        by: ["commentId"],
        where: { comment: { billId: id } },
        _sum: { voteType: true },
      }),
    ]);

    // Build vote count map
    const voteMap = new Map<number, number>();
    for (const v of voteSums) {
      voteMap.set(v.commentId, v._sum.voteType || 0);
    }

    // Build tree in memory
    const commentMap = new Map<number, CommentWithReplies>();
    const topLevel: CommentWithReplies[] = [];

    for (const c of allComments) {
      const node: CommentWithReplies = {
        id: c.id,
        content: c.content,
        userId: c.userId,
        username: c.profile?.username ?? c.username,
        billId: c.billId,
        parentCommentId: c.parentCommentId,
        date: c.date,
        voteCount: voteMap.get(c.id) || 0,
        replies: [],
      };
      commentMap.set(c.id, node);
    }

    // Assemble tree
    for (const node of commentMap.values()) {
      if (node.parentCommentId === null) {
        topLevel.push(node);
      } else {
        const parent = commentMap.get(node.parentCommentId);
        if (parent) {
          parent.replies.push(node);
        } else {
          // Orphaned reply — show at top level
          topLevel.push(node);
        }
      }
    }

    // Sort
    if (sortOption === "best") {
      topLevel.sort((a, b) => b.voteCount - a.voteCount);
    } else {
      topLevel.sort((a, b) => b.date.getTime() - a.date.getTime());
    }

    // Sort replies by date within each thread
    for (const node of commentMap.values()) {
      if (node.replies.length > 1) {
        node.replies.sort((a, b) => a.date.getTime() - b.date.getTime());
      }
    }

    // Paginate top-level only
    const paginated = topLevel.slice(skip, skip + limit);
    const total = allComments.length;

    return NextResponse.json({ comments: paginated, total });
  } catch (error) {
    console.error("Error fetching comments:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
