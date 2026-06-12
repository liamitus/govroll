import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { reportError } from "@/lib/error-reporting";
import { checkContentL2 } from "@/lib/moderation/layer2";
import {
  assertUserCommentRateLimit,
  getClientIp,
  RateLimitError,
} from "@/lib/rate-limit";

const COMMENTS_PER_USER_PER_HOUR = 30;

export async function POST(request: NextRequest) {
  const { userId, username, error } = await getAuthenticatedUser();
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
  const { billId, content, parentCommentId } = body;

  if (!billId || !content) {
    return NextResponse.json(
      { error: "billId and content are required" },
      { status: 400 },
    );
  }

  if (content.length > 10000) {
    return NextResponse.json(
      { error: "Comment is too long." },
      { status: 400 },
    );
  }

  // Duplicate check
  const recentComment = await prisma.comment.findFirst({
    where: {
      userId,
      billId,
      content,
      date: { gte: new Date(Date.now() - 60000) },
    },
  });

  if (recentComment) {
    return NextResponse.json(
      { error: "Duplicate comment detected" },
      { status: 429 },
    );
  }

  // Per-user posting cap (authoritative, DB-backed across instances).
  try {
    await assertUserCommentRateLimit(userId, COMMENTS_PER_USER_PER_HOUR);
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        {
          error: "You're posting too quickly. Please wait a bit and try again.",
        },
        { status: 429 },
      );
    }
    throw err;
  }

  // AI moderation. Fails open on API/network errors and rate-limit hits —
  // deny-list pre-filters remain. If we start seeing frequent rate-limit
  // fallbacks in error alerts, that's the signal to queue moderation async
  // (persist comment as PENDING, run L2 offline, surface via admin review).
  const mod = await checkContentL2(content, getClientIp(request));
  if (mod.flagged) {
    return NextResponse.json(
      {
        error:
          "Your comment was flagged by our moderation system. Please revise it and try again.",
      },
      { status: 400 },
    );
  }
  if (mod.error === "rate_limited") {
    reportError(
      new Error("Moderation rate-limited — comment posted unscreened"),
      {
        route: "POST /api/comments",
        feature: "moderation_content",
      },
    );
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

    // Validate the parent (if replying): it must exist and belong to THIS
    // bill. A cross-bill parent isn't found by this bill's tree-builder and
    // renders as a bogus top-level comment; a nonexistent parent would 500 on
    // the FK constraint at insert time.
    let parentId: number | null = null;
    if (parentCommentId != null) {
      parentId = Number(parentCommentId);
      if (!Number.isInteger(parentId) || parentId <= 0) {
        return NextResponse.json(
          { error: "Invalid parent comment" },
          { status: 400 },
        );
      }
      const parent = await prisma.comment.findUnique({
        where: { id: parentId },
        select: { billId: true },
      });
      if (!parent || parent.billId !== billId) {
        return NextResponse.json(
          { error: "Parent comment does not belong to this bill" },
          { status: 400 },
        );
      }
    }

    const comment = await prisma.comment.create({
      data: {
        userId,
        username,
        billId,
        content,
        parentCommentId: parentId,
      },
    });

    return NextResponse.json(comment, { status: 201 });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "api_error",
        route: "POST /api/comments",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    reportError(err, { route: "POST /api/comments" });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
