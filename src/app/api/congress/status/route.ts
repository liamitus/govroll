import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type {
  Chamber,
  StatusCode,
  SignalSource,
} from "@/lib/congress-session/types";

/**
 * Public read endpoint for the CongressStatus pill in the nav bar.
 *
 * No auth — this data is already public. Aggressively short-cached because
 * the underlying state changes on a 10-minute cron and clients poll every
 * ~60s anyway.
 *
 * Returns `{ chambers: { house, senate } }`. A chamber is missing (not
 * `unknown`) only if the cron has never populated it yet, which is
 * effectively first-deploy-before-first-cron — clients should render the
 * `unknown` visual state in that case.
 */

// Pre-rendering this route would run at build time, where Vercel builds
// can't reach the database — the route must always be handled at request
// time. Edge caching is handled via the Cache-Control header below.
export const dynamic = "force-dynamic";

export interface ChamberStatusPayload {
  chamber: Chamber;
  status: StatusCode;
  detail: string | null;
  source: SignalSource;
  lastActionAt: string | null;
  nextTransitionAt: string | null;
  nextTransitionLabel: string | null;
  scheduledConveneAt: string | null;
  lastCheckedAt: string;
}

export interface CongressStatusResponse {
  chambers: {
    house: ChamberStatusPayload | null;
    senate: ChamberStatusPayload | null;
  };
}

export async function GET() {
  const rows = await prisma.congressChamberStatus.findMany({
    where: { chamber: { in: ["house", "senate"] } },
  });

  const byChamber = new Map(rows.map((r) => [r.chamber, r]));
  const shape = (
    row: (typeof rows)[number] | undefined,
  ): ChamberStatusPayload | null =>
    row
      ? {
          chamber: row.chamber as Chamber,
          status: row.status as StatusCode,
          detail: row.detail,
          source: row.source as SignalSource,
          lastActionAt: row.lastActionAt?.toISOString() ?? null,
          nextTransitionAt: row.nextTransitionAt?.toISOString() ?? null,
          nextTransitionLabel: row.nextTransitionLabel,
          scheduledConveneAt: row.scheduledConveneAt?.toISOString() ?? null,
          lastCheckedAt: row.lastCheckedAt.toISOString(),
        }
      : null;

  const body: CongressStatusResponse = {
    chambers: {
      house: shape(byChamber.get("house")),
      senate: shape(byChamber.get("senate")),
    },
  };

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300",
    },
  });
}
