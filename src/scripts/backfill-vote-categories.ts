import "dotenv/config";
import axios from "axios";
import { createStandalonePrisma } from "../lib/prisma-standalone";

const prisma = createStandalonePrisma();
const BASE_URL = "https://www.govtrack.us/api/v2";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Roll-call numbers reset every session (calendar year), so #50 in 2025 and
// #50 in 2026 are entirely different votes. This script resolves a category
// for a (congress, session) and stamps it onto matching rows — so it MUST be
// scoped to that session, or a 2026 run would (a) look the wrong year's vote
// up on GovTrack and (b) overwrite the other session's rows that share a
// number. Congress/session are CLI args (or env) instead of hardcoded, and
// every DB touch is fenced to the session's calendar year via votedAt.
//
//   npx tsx src/scripts/backfill-vote-categories.ts 119 2026
function parseTarget(): { congress: number; session: number } {
  const congress = Number(
    process.argv[2] ?? process.env.BACKFILL_CONGRESS ?? 119,
  );
  const session = Number(
    process.argv[3] ?? process.env.BACKFILL_SESSION ?? 2025,
  );
  if (!Number.isInteger(congress) || !Number.isInteger(session)) {
    throw new Error(
      `Invalid congress/session: ${process.argv[2]}/${process.argv[3]} ` +
        `(usage: backfill-vote-categories.ts <congress> <session-year>)`,
    );
  }
  return { congress, session };
}

async function backfill() {
  const { congress, session } = parseTarget();
  // Modern sessions are calendar years; fence every query to [Jan 1, next
  // Jan 1) so we never read or write rows outside this session.
  const sessionStart = new Date(Date.UTC(session, 0, 1));
  const sessionEnd = new Date(Date.UTC(session + 1, 0, 1));
  const inSession = { gte: sessionStart, lt: sessionEnd };

  console.log(
    `Backfilling vote categories for congress ${congress}, session ${session} ` +
      `(${sessionStart.toISOString().slice(0, 10)} … ${sessionEnd
        .toISOString()
        .slice(0, 10)})`,
  );

  // Distinct roll calls missing a category WITHIN this session. Rows with a
  // null votedAt can't be placed in a session, so they're skipped rather than
  // risk a cross-session mis-stamp.
  const votesWithoutCategory = await prisma.representativeVote.findMany({
    where: {
      category: null,
      rollCallNumber: { not: null },
      votedAt: inSession,
    },
    select: { rollCallNumber: true, chamber: true },
    distinct: ["rollCallNumber", "chamber"],
  });

  console.log(
    `Found ${votesWithoutCategory.length} distinct roll calls to backfill`,
  );

  for (const { rollCallNumber, chamber } of votesWithoutCategory) {
    if (!rollCallNumber || !chamber) continue;

    try {
      // Look up this roll call vote on GovTrack
      const res = await axios.get(`${BASE_URL}/vote`, {
        params: {
          chamber,
          number: rollCallNumber,
          congress,
          session,
          limit: 1,
        },
      });

      const voteObj = res.data.objects?.[0];
      if (!voteObj?.category) {
        console.log(
          `  No category found for ${chamber} roll call #${rollCallNumber}`,
        );
        continue;
      }

      const updated = await prisma.representativeVote.updateMany({
        where: { rollCallNumber, chamber, votedAt: inSession },
        data: { category: voteObj.category },
      });

      console.log(
        `  ${chamber} #${rollCallNumber}: ${voteObj.category} (${updated.count} records)`,
      );

      await delay(300);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  Error for ${chamber} #${rollCallNumber}: ${msg}`);
    }
  }

  console.log("Backfill complete.");
  await prisma.$disconnect();
}

backfill().catch((err) => {
  console.error("Backfill failed:", err);
  process.exitCode = 1;
});
