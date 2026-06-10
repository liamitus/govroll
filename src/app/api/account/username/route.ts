import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { checkNameL1 } from "@/lib/moderation/layer1";
import { checkNameL2 } from "@/lib/moderation/layer2";
import { getClientIp } from "@/lib/rate-limit";

export async function PATCH(request: NextRequest) {
  const { userId, error } = await getAuthenticatedUser();
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
  const { username } = body;

  if (!username || typeof username !== "string" || !username.trim()) {
    return NextResponse.json(
      { error: "Username is required" },
      { status: 400 },
    );
  }

  const trimmed = username.trim();

  // Layer 1 — deterministic checks (length, charset, slurs, public figures, spam).
  const l1 = checkNameL1(trimmed);
  if (!l1.ok) {
    return NextResponse.json(
      { error: l1.reason ?? "Username is not allowed." },
      { status: 400 },
    );
  }

  // Layer 2 — OpenAI moderation. Fails open; we don't leak category labels.
  const l2 = await checkNameL2(trimmed, getClientIp(request));
  if (l2.flagged) {
    return NextResponse.json(
      { error: "That username cannot be used. Please choose another." },
      { status: 400 },
    );
  }

  await Promise.all([
    prisma.profile.update({
      where: { id: userId },
      data: { username: trimmed },
    }),
    prisma.comment.updateMany({
      where: { userId },
      data: { username: trimmed },
    }),
  ]);

  return NextResponse.json({ updated: true });
}
