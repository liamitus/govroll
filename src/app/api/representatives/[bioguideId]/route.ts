import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isYesVote, isNoVote, isPassageCategory } from "@/lib/votes";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ bioguideId: string }> },
) {
  const { bioguideId } = await params;

  try {
    const rep = await prisma.representative.findUnique({
      where: { bioguideId },
    });

    if (!rep) {
      return NextResponse.json(
        { error: "Representative not found" },
        { status: 404 },
      );
    }

    // Fetch rep's voting record with full per-roll-call metadata. Same
    // bill produces multiple roll calls (motion to proceed, cloture,
    // amendments, final passage); the client uses these fields to group
    // them under one row instead of N duplicate-titled rows.
    const repVotes = await prisma.representativeVote.findMany({
      where: { representativeId: rep.id },
      select: {
        vote: true,
        rollCallNumber: true,
        chamber: true,
        votedAt: true,
        category: true,
        bill: {
          select: {
            id: true,
            billId: true,
            title: true,
            date: true,
            link: true,
            currentStatus: true,
          },
        },
      },
      // votedAt desc, with bill.date as fallback for legacy rows that
      // pre-date the votedAt backfill.
      orderBy: [{ votedAt: "desc" }, { bill: { date: "desc" } }],
    });

    // Count bills this rep has sponsored
    const fullName = `${rep.firstName} ${rep.lastName}`;
    const sponsoredBillsCount = await prisma.bill.count({
      where: {
        sponsor: { contains: fullName },
      },
    });

    // Optionally fetch user's votes on the same bills
    let userVotes: Record<number, string> | null = null;
    try {
      const supabase = await createSupabaseServerClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const billIds = repVotes.map((rv) => rv.bill.id);
        const votes = await prisma.vote.findMany({
          where: {
            userId: user.id,
            billId: { in: billIds },
          },
        });
        userVotes = {};
        for (const v of votes) {
          userVotes[v.billId] = v.voteType;
        }
      }
    } catch {
      // No auth session — userVotes stays null
    }

    // Build voting record
    const votingRecord = repVotes.map((rv) => ({
      billId: rv.bill.id,
      billSlug: rv.bill.billId,
      title: rv.bill.title,
      date: rv.bill.date.toISOString(),
      repVote: rv.vote,
      link: rv.bill.link,
      category: rv.category,
      billStatus: rv.bill.currentStatus,
      rollCallNumber: rv.rollCallNumber,
      chamber: rv.chamber,
      votedAt: rv.votedAt ? rv.votedAt.toISOString() : null,
    }));

    // Key votes: substantive yea/nay votes (passage / passage_suspension /
    // veto_override), one per bill, most recent first. Earlier this filtered
    // only `category === "passage"` and only `Yea`/`Nay` — so House reps
    // (who vote `Aye`/`No`) and bills passed under suspension never showed up.
    const seenBillIds = new Set<number>();
    const keyVotes = votingRecord
      .filter(
        (v) =>
          isPassageCategory(v.category) &&
          (isYesVote(v.repVote) || isNoVote(v.repVote)),
      )
      .filter((v) => {
        if (seenBillIds.has(v.billId)) return false;
        seenBillIds.add(v.billId);
        return true;
      })
      .slice(0, 6);

    // Compute stats. yea/nay counts use the shared helper so House Aye/No
    // are counted alongside Senate Yea/Nay.
    const totalVotes = repVotes.length;
    const missedVotes = repVotes.filter(
      (rv) => rv.vote === "Not Voting",
    ).length;
    const yeaCount = repVotes.filter((rv) => isYesVote(rv.vote)).length;
    const nayCount = repVotes.filter((rv) => isNoVote(rv.vote)).length;

    return NextResponse.json({
      representative: {
        id: rep.id,
        bioguideId: rep.bioguideId,
        slug: rep.slug,
        firstName: rep.firstName,
        lastName: rep.lastName,
        state: rep.state,
        district: rep.district,
        party: rep.party,
        chamber: rep.chamber,
        imageUrl: rep.imageUrl,
        link: rep.link,
      },
      votingRecord,
      keyVotes,
      sponsoredBillsCount,
      userVotes,
      stats: {
        totalVotes,
        missedVotes,
        missedVotePct:
          totalVotes > 0 ? Math.round((missedVotes / totalVotes) * 100) : 0,
        yeaCount,
        nayCount,
      },
    });
  } catch (error) {
    console.error("Error fetching representative detail:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
