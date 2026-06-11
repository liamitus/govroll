import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUserId } from "@/lib/auth";

/**
 * POST /api/account/link-donation
 *
 * Claims a donation by providing a one-time link token. This lets donors
 * who checked out without logging in attach the donation to their account.
 * The token is included in the post-donation email.
 */
export async function POST(request: NextRequest) {
  // getAuthenticatedUserId lazily upserts the Profile row, so a brand-new
  // user clicking the email link first thing won't trip the
  // Donation.userId → Profile.id FK constraint below.
  const auth = await getAuthenticatedUserId();
  if (auth.error) {
    return NextResponse.json(
      { error: "Sign in to link a donation." },
      { status: 401 },
    );
  }
  const userId = auth.userId;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }
  const { token } = body;
  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "Token is required." }, { status: 400 });
  }

  const linkToken = await prisma.donorLinkToken.findUnique({
    where: { token },
    include: { donation: { select: { id: true, userId: true } } },
  });

  if (!linkToken) {
    return NextResponse.json(
      { error: "Invalid or expired link." },
      { status: 404 },
    );
  }

  if (linkToken.usedAt) {
    return NextResponse.json(
      { error: "This link has already been used." },
      { status: 409 },
    );
  }

  if (linkToken.expiresAt < new Date()) {
    return NextResponse.json(
      { error: "This link has expired." },
      { status: 410 },
    );
  }

  if (linkToken.donation.userId) {
    return NextResponse.json(
      { error: "This donation is already linked to an account." },
      { status: 409 },
    );
  }

  // Atomically claim the token, then link the donation. The conditional
  // updateMany (usedAt: null) means only one concurrent request can win the
  // claim, closing the read-then-write TOCTOU on usedAt above.
  const claimed = await prisma.$transaction(async (tx) => {
    const claim = await tx.donorLinkToken.updateMany({
      where: { id: linkToken.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claim.count === 0) return false;
    await tx.donation.updateMany({
      where: { id: linkToken.donationId, userId: null },
      data: { userId },
    });
    return true;
  });

  if (!claimed) {
    return NextResponse.json(
      { error: "This link has already been used." },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, donationId: linkToken.donationId });
}
