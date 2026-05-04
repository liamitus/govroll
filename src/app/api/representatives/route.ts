import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRepresentativesByAddress } from "@/lib/civic-api";
import {
  summarizeChamberPassage,
  type ChamberPassage,
} from "@/lib/passage-summary";

export async function POST(request: NextRequest) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }
  const { address, billId } = body;

  if (!address || !billId) {
    return NextResponse.json(
      { error: "Address and billId are required" },
      { status: 400 },
    );
  }

  try {
    const data = await getRepresentativesByAddress(address);
    if (!data) {
      return NextResponse.json(
        {
          error:
            "Could not geocode address. Please check the address and try again.",
        },
        { status: 400 },
      );
    }
    const { officials } = data;

    const bill = await prisma.bill.findUnique({
      where: { id: parseInt(billId) },
      // Only billType, currentStatus, sponsorBioguideId are read from this
      // row — skip fullText and other large columns so this endpoint
      // doesn't ship megabytes per request.
      select: {
        id: true,
        billType: true,
        currentStatus: true,
        sponsorBioguideId: true,
        introducedDate: true,
      },
    });

    if (!bill) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    }

    // Count roll calls per chamber for this bill, split into passage
    // votes vs procedural votes. Only passage votes prove the chamber
    // recorded individual names on final disposition — a motion to
    // suspend or recommit gets a recorded vote even when the bill
    // itself passes by voice afterward.
    const rollCallsByChamberAndCategory =
      await prisma.representativeVote.groupBy({
        by: ["chamber", "category"],
        where: { billId: parseInt(billId) },
        _count: { rollCallNumber: true },
      });

    const passageCategorySet = new Set([
      "passage",
      "passage_suspension",
      "veto_override",
    ]);
    const rollCallCounts = {
      house: { passage: 0, procedural: 0 },
      senate: { passage: 0, procedural: 0 },
    };
    for (const row of rollCallsByChamberAndCategory) {
      const chamberKey = (row.chamber || "").toLowerCase() as
        | "house"
        | "senate"
        | "";
      if (chamberKey !== "house" && chamberKey !== "senate") continue;
      const bucket = passageCategorySet.has(row.category || "")
        ? "passage"
        : "procedural";
      rollCallCounts[chamberKey][bucket] += row._count.rollCallNumber;
    }

    const chamberPassage: ChamberPassage[] = summarizeChamberPassage(
      { billType: bill.billType, currentStatus: bill.currentStatus },
      rollCallCounts,
    );

    // Derived legacy chamber filter used below when matching reps
    const relevantChambers: string[] = [];
    if (chamberPassage.some((c) => c.chamber === "house"))
      relevantChambers.push("representative");
    if (chamberPassage.some((c) => c.chamber === "senate"))
      relevantChambers.push("senator");

    // `officials` are already full Representative rows loaded in
    // getRepresentativesByAddress — re-fetching them here would be a
    // redundant round trip per rep. Fan out the vote + cosponsor lookups
    // as two batched findMany calls instead of 2N per-rep queries, which
    // is what pushed this route past the 60s Hobby cap.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const repIds: number[] = officials
      .map((o: any) => o.id)
      .filter((id: unknown): id is number => typeof id === "number" && id > 0);

    const billIdInt = parseInt(billId);

    const [allVotesForBill, cosponsorRows] =
      repIds.length > 0
        ? await Promise.all([
            prisma.representativeVote.findMany({
              where: {
                billId: billIdInt,
                representativeId: { in: repIds },
              },
              orderBy: { votedAt: "desc" },
              select: {
                representativeId: true,
                vote: true,
                rollCallNumber: true,
                chamber: true,
                votedAt: true,
                category: true,
              },
            }),
            prisma.billCosponsor.findMany({
              where: {
                billId: billIdInt,
                representativeId: { in: repIds },
              },
              select: {
                representativeId: true,
                sponsoredAt: true,
                isOriginal: true,
                withdrawnAt: true,
              },
            }),
          ])
        : [[], []];

    type VoteRow = (typeof allVotesForBill)[number];
    const votesByRep = new Map<number, VoteRow[]>();
    for (const v of allVotesForBill) {
      const bucket = votesByRep.get(v.representativeId);
      if (bucket) bucket.push(v);
      else votesByRep.set(v.representativeId, [v]);
    }
    const cosponsorByRep = new Map(
      cosponsorRows.map((c) => [c.representativeId, c] as const),
    );

    const passageCategories = new Set([
      "passage",
      "passage_suspension",
      "veto_override",
    ]);
    const amendmentCategories = new Set([
      "amendment",
      "procedural",
      "cloture",
      "nomination",
    ]);

    const repsWithVotes = officials.map((official: any) => {
      const allVotes = votesByRep.get(official.id) ?? [];
      const cosponsorRow = cosponsorByRep.get(official.id) ?? null;

      // Pick the best vote: passage categories first, then
      // uncategorized (likely passage with missing metadata),
      // then anything else (amendments, procedural) as last resort
      const passageVotes = allVotes.filter(
        (v) => v.category && passageCategories.has(v.category),
      );
      const uncategorizedVotes = allVotes.filter((v) => !v.category);
      const otherVotes = allVotes.filter(
        (v) =>
          v.category &&
          !passageCategories.has(v.category) &&
          !amendmentCategories.has(v.category),
      );
      const amendmentVotes = allVotes.filter(
        (v) => v.category && amendmentCategories.has(v.category),
      );

      // Prioritized: passage > uncategorized > other > amendment
      const votes =
        passageVotes.length > 0
          ? passageVotes
          : uncategorizedVotes.length > 0
            ? uncategorizedVotes
            : otherVotes.length > 0
              ? otherVotes
              : amendmentVotes;

      const latestVote = votes[0];

      return {
        bioguideId: official.bioguideId,
        slug: official.slug,
        firstName: official.firstName,
        lastName: official.lastName,
        state: official.state,
        district: official.district,
        party: official.party,
        chamber: official.chamber,
        imageUrl: official.imageUrl,
        link: official.link,
        phone: official.phone ?? null,
        id: official.id,
        name: official.name,
        vote: latestVote?.vote || "No vote recorded",
        voteCategory: latestVote?.category || null,
        voteDate: latestVote?.votedAt?.toISOString() || null,
        voteHistory:
          allVotes.length > 1
            ? allVotes.map((v) => ({
                vote: v.vote,
                rollCallNumber: v.rollCallNumber,
                chamber: v.chamber,
                votedAt: v.votedAt?.toISOString() || null,
              }))
            : null,
        cosponsorship: cosponsorRow
          ? {
              sponsoredAt: cosponsorRow.sponsoredAt?.toISOString() || null,
              isOriginal: cosponsorRow.isOriginal,
              withdrawnAt: cosponsorRow.withdrawnAt?.toISOString() || null,
            }
          : null,
      };
    });
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const filteredReps = repsWithVotes.filter((rep) =>
      relevantChambers.includes(rep.chamber),
    );

    return NextResponse.json({
      representatives: filteredReps,
      chamberPassage,
      sponsorBioguideId: bill.sponsorBioguideId,
      introducedDate: bill.introducedDate?.toISOString() ?? null,
    });
  } catch (error) {
    console.error("Error fetching representatives:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
