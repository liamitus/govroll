import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { reportError } from "@/lib/error-reporting";

export async function DELETE() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Account deletion is not configured. Contact support." },
      { status: 500 },
    );
  }

  try {
    // Atomically scrub every DB row tied to this user. One transaction means
    // a mid-deletion failure can't leave the account half-deleted (e.g.
    // votes gone but the profile and AI-usage rows still linked). The
    // Supabase auth user is removed afterward — it's an external service and
    // can't participate in a DB transaction.
    await prisma.$transaction([
      // Anonymize comments — preserve content for thread continuity
      prisma.comment.updateMany({
        where: { userId: user.id },
        data: { userId: null, username: "Deleted User" },
      }),
      // Delete private data
      prisma.commentVote.deleteMany({ where: { userId: user.id } }),
      prisma.voteHistory.deleteMany({ where: { userId: user.id } }),
      prisma.vote.deleteMany({ where: { userId: user.id } }),
      // Conversations + messages (messages cascade from conversation)
      prisma.conversation.deleteMany({ where: { userId: user.id } }),
      // Nullify donation userId — keep records for accounting
      prisma.donation.updateMany({
        where: { userId: user.id },
        data: { userId: null },
      }),
      // Nullify AI usage events — keep the aggregate logs, drop the user link
      prisma.aiUsageEvent.updateMany({
        where: { userId: user.id },
        data: { userId: null },
      }),
      // Delete Profile — deleteMany so a missing row (very old accounts)
      // doesn't abort the transaction the way delete() would
      prisma.profile.deleteMany({ where: { id: user.id } }),
    ]);

    // Delete the Supabase auth user (external service — outside the DB tx)
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { error } = await adminClient.auth.admin.deleteUser(user.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Error deleting account:", err);
    reportError(err, { route: "DELETE /api/account/delete" });
    return NextResponse.json(
      { error: "Failed to delete account. Contact support." },
      { status: 500 },
    );
  }
}
