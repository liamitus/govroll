import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { statusMapping } from "@/lib/status-mapping";
import {
  parseBillCitation,
  type BillCitation,
} from "@/lib/parse-bill-citation";
import type { BillSummary, ParsedCitationSummary } from "@/types";

const LIVE_TIERS = ["ACTIVE", "ADVANCING", "ENACTED"];
const GRAVEYARD_TIERS = ["DEAD"];

export type BillsSortBy = "relevant" | "latest" | "newest";
export type BillsMomentum = "live" | "graveyard" | "all";
export type BillsChamber = "both" | "house" | "senate";

export interface BillsQueryInput {
  page: number;
  limit: number;
  chamber: BillsChamber;
  status: string;
  momentum: BillsMomentum;
  sortBy: BillsSortBy;
  search: string;
  /** Comma-separated policy areas. */
  topic: string;
}

export interface BillsQueryResult {
  total: number;
  page: number;
  pageSize: number;
  bills: BillSummary[];
  hiddenByMomentum: number;
  citation: ParsedCitationSummary | null;
  exactMatch: BillSummary | null;
}

// Columns pulled from Bill for both the listing and search paths. Keep in
// sync with transformBill below.
const BILL_SELECT = {
  id: true,
  billId: true,
  title: true,
  date: true,
  billType: true,
  currentChamber: true,
  currentStatus: true,
  currentStatusDate: true,
  introducedDate: true,
  link: true,
  shortText: true,
  sponsor: true,
  policyArea: true,
  latestActionText: true,
  latestActionDate: true,
  momentumTier: true,
  momentumScore: true,
  daysSinceLastAction: true,
  deathReason: true,
  popularTitle: true,
  shortTitle: true,
  displayTitle: true,
  _count: {
    select: { publicVotes: true, comments: true },
  },
} as const;

type RawBill = Awaited<
  ReturnType<typeof prisma.bill.findFirst<{ select: typeof BILL_SELECT }>>
>;

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function transformBill(b: NonNullable<RawBill>): BillSummary {
  const {
    _count,
    date,
    currentStatusDate,
    introducedDate,
    latestActionDate,
    ...rest
  } = b;
  return {
    ...(rest as unknown as BillSummary),
    date: iso(date)!,
    currentStatusDate: iso(currentStatusDate),
    introducedDate: iso(introducedDate),
    latestActionDate: iso(latestActionDate),
    shortText: b.shortText ? b.shortText.slice(0, 280) : null,
    publicVoteCount: _count.publicVotes,
    commentCount: _count.comments,
  };
}

/**
 * Look up a bill by parsed citation. If the user supplied a Congress we
 * match exactly; otherwise we pick the most recent Congress that has a
 * matching type+number pair.
 */
async function findBillByCitation(
  citation: BillCitation,
): Promise<BillSummary | null> {
  if (citation.congress !== null) {
    const exactId = `${citation.billType}-${citation.number}-${citation.congress}`;
    const bill = await prisma.bill.findUnique({
      where: { billId: exactId },
      select: BILL_SELECT,
    });
    return bill ? transformBill(bill) : null;
  }

  const prefix = `${citation.billType}-${citation.number}-`;
  const matches = await prisma.bill.findMany({
    where: { billId: { startsWith: prefix } },
    orderBy: [
      { congressNumber: { sort: "desc", nulls: "last" } },
      { introducedDate: "desc" },
    ],
    take: 1,
    select: BILL_SELECT,
  });
  return matches[0] ? transformBill(matches[0]) : null;
}

/** Build shared WHERE fragments used by both the Prisma and raw-SQL paths. */
function buildFilterFragments(input: BillsQueryInput) {
  const { chamber, status, momentum, topic } = input;
  const fragments: Prisma.Sql[] = [];
  const fragmentsAllMomentum: Prisma.Sql[] = [];

  if (chamber !== "both") {
    fragments.push(Prisma.sql`b."billType" LIKE ${chamber + "%"}`);
    fragmentsAllMomentum.push(Prisma.sql`b."billType" LIKE ${chamber + "%"}`);
  }

  if (status && statusMapping[status]) {
    const values = statusMapping[status];
    fragments.push(Prisma.sql`b."currentStatus" IN (${Prisma.join(values)})`);
    fragmentsAllMomentum.push(
      Prisma.sql`b."currentStatus" IN (${Prisma.join(values)})`,
    );
  }

  if (topic) {
    const topics = topic.split(",").filter(Boolean);
    if (topics.length > 0) {
      fragments.push(Prisma.sql`b."policyArea" IN (${Prisma.join(topics)})`);
      fragmentsAllMomentum.push(
        Prisma.sql`b."policyArea" IN (${Prisma.join(topics)})`,
      );
    }
  }

  if (momentum === "live") {
    fragments.push(
      Prisma.sql`b."momentumTier" IN (${Prisma.join(LIVE_TIERS)})`,
    );
  } else if (momentum === "graveyard") {
    fragments.push(
      Prisma.sql`b."momentumTier" IN (${Prisma.join(GRAVEYARD_TIERS)})`,
    );
  }

  return { fragments, fragmentsAllMomentum };
}

function andJoin(fragments: Prisma.Sql[]): Prisma.Sql {
  if (fragments.length === 0) return Prisma.sql`TRUE`;
  return Prisma.join(fragments, " AND ");
}

/**
 * Full-text + fuzzy search path. Uses the weighted tsvector generated
 * column primarily (popular+display=A, short=B, title=C, summary=D) and
 * ORs in pg_trgm similarity for typo tolerance. A bill is returned if
 * either signal matches, and is ranked by the greater of the two scores.
 */
async function searchBillsPage(
  input: BillsQueryInput,
): Promise<Omit<BillsQueryResult, "citation" | "exactMatch">> {
  const { page, limit, momentum, search } = input;
  const skip = (page - 1) * limit;
  const { fragments, fragmentsAllMomentum } = buildFilterFragments(input);

  // websearch_to_tsquery never raises on bad input — safe for the public
  // search box. Tagged-template parameterization keeps it injection-safe.
  const tsQuerySql = Prisma.sql`websearch_to_tsquery('english', ${search})`;

  // similarity() on NULL returns NULL; COALESCE keeps the GREATEST sane.
  // Multipliers below normalize similarity scores against ts_rank_cd so
  // a full popular-title match still ranks alongside a good FTS hit.
  const rankSql = Prisma.sql`GREATEST(
    COALESCE(ts_rank_cd(b."searchVector", q) * 2.0, 0),
    COALESCE(similarity(b."popularTitle", ${search}), 0) * 0.9,
    COALESCE(similarity(b."shortTitle", ${search}), 0) * 0.6,
    COALESCE(similarity(b."displayTitle", ${search}), 0) * 0.7,
    COALESCE(similarity(b."title", ${search}), 0) * 0.3
  )`;

  // Match condition: tsvector hit OR any title column similar enough that
  // pg_trgm's default 0.3 threshold passes (the `%` operator).
  const searchMatchSql = Prisma.sql`(
    b."searchVector" @@ q
    OR b."popularTitle" % ${search}
    OR b."shortTitle" % ${search}
    OR b."displayTitle" % ${search}
    OR b."title" % ${search}
  )`;

  const whereWithMomentum = andJoin([...fragments, searchMatchSql]);
  const whereWithoutMomentum = andJoin([
    ...fragmentsAllMomentum,
    searchMatchSql,
  ]);

  const [rows, countRows, allMomentumCountRows] = await Promise.all([
    prisma.$queryRaw<{ id: number }[]>`
      SELECT b.id
      FROM "Bill" b, ${tsQuerySql} q
      WHERE ${whereWithMomentum}
      ORDER BY ${rankSql} DESC,
        b."momentumScore" DESC NULLS LAST,
        b."introducedDate" DESC NULLS LAST
      OFFSET ${skip} LIMIT ${limit}
    `,
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "Bill" b, ${tsQuerySql} q
      WHERE ${whereWithMomentum}
    `,
    momentum === "all"
      ? Promise.resolve([{ count: BigInt(0) }])
      : prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*)::bigint AS count
          FROM "Bill" b, ${tsQuerySql} q
          WHERE ${whereWithoutMomentum}
        `,
  ]);

  const ids = rows.map((r) => r.id);
  const total = Number(countRows[0]?.count ?? BigInt(0));
  const totalAllMomentum = Number(allMomentumCountRows[0]?.count ?? BigInt(0));

  const billRows = ids.length
    ? await prisma.bill.findMany({
        where: { id: { in: ids } },
        select: BILL_SELECT,
      })
    : [];

  const billMap = new Map(billRows.map((b) => [b.id, b] as const));
  const ordered = ids
    .map((id) => billMap.get(id))
    .filter((b): b is NonNullable<typeof b> => !!b)
    .map(transformBill);

  const hiddenByMomentum =
    momentum === "all" ? 0 : Math.max(0, totalAllMomentum - total);

  return {
    total,
    page,
    pageSize: limit,
    bills: ordered,
    hiddenByMomentum,
  };
}

/**
 * Plain listing path — no search. Keeps the existing Prisma-native query
 * so ordering by vote/comment counts stays ergonomic.
 */
async function listBillsPage(
  input: BillsQueryInput,
): Promise<Omit<BillsQueryResult, "citation" | "exactMatch">> {
  const { page, limit, chamber, status, momentum, sortBy, topic } = input;
  const skip = (page - 1) * limit;

  const filters: Record<string, unknown> = {};

  if (chamber !== "both") {
    filters.billType = { startsWith: chamber.toLowerCase() };
  }

  if (status && statusMapping[status]) {
    filters.currentStatus = { in: statusMapping[status] };
  }

  if (momentum === "live") {
    filters.momentumTier = { in: LIVE_TIERS };
  } else if (momentum === "graveyard") {
    filters.momentumTier = { in: GRAVEYARD_TIERS };
  }

  if (topic) {
    filters.policyArea = { in: topic.split(",") };
  }

  let orderBy: Record<string, unknown>[] | Record<string, unknown>;
  if (sortBy === "relevant") {
    orderBy = [
      { momentumScore: { sort: "desc", nulls: "last" } },
      { votes: { _count: "desc" } },
      { publicVotes: { _count: "desc" } },
      { comments: { _count: "desc" } },
      { latestActionDate: { sort: "desc", nulls: "last" } },
    ];
  } else if (sortBy === "latest") {
    orderBy = [{ latestActionDate: { sort: "desc", nulls: "last" } }];
  } else {
    orderBy = [{ introducedDate: "desc" }];
  }

  const filtersAllMomentum = { ...filters };
  delete (filtersAllMomentum as Record<string, unknown>).momentumTier;

  const [total, totalAllMomentum, bills] = await Promise.all([
    prisma.bill.count({ where: filters }),
    momentum === "all"
      ? Promise.resolve(0)
      : prisma.bill.count({ where: filtersAllMomentum }),
    prisma.bill.findMany({
      where: filters,
      skip,
      take: limit,
      orderBy,
      select: BILL_SELECT,
    }),
  ]);

  return {
    total,
    page,
    pageSize: limit,
    bills: bills.map(transformBill),
    hiddenByMomentum:
      momentum === "all" ? 0 : Math.max(0, totalAllMomentum - total),
  };
}

/**
 * Canonical bill-listing query. Called by both `GET /api/bills` (for
 * client-side pagination) and the Bills page RSC (for page-1 prefetch).
 *
 * Dispatch:
 *   - search parses as a bill citation ("HR 1234", "S.J.Res. 10") →
 *     resolve exactMatch, then list with the search term removed so the
 *     user also sees the regular feed beneath the jump-to row.
 *   - search present otherwise → weighted full-text + pg_trgm search.
 *   - no search → plain filter-driven listing.
 */
export async function fetchBillsPage(
  input: BillsQueryInput,
): Promise<BillsQueryResult> {
  const rawSearch = input.search.trim();
  const citation = rawSearch ? parseBillCitation(rawSearch) : null;

  let exactMatch: BillSummary | null = null;
  if (citation) {
    exactMatch = await findBillByCitation(citation);
  }

  const citationSummary: ParsedCitationSummary | null = citation
    ? {
        shortLabel: citation.shortLabel,
        number: citation.number,
        congress: citation.congress,
      }
    : null;

  // When the search parses as a citation, drop the search term from the
  // filter query — "HR 1234" as a tsvector/similarity search returns
  // nothing useful. Users get the jump-to row plus the normal feed.
  const useSearchPath = !!rawSearch && rawSearch.length >= 2 && !citation;

  const base = useSearchPath
    ? await searchBillsPage({ ...input, search: rawSearch })
    : await listBillsPage({ ...input, search: "" });

  return {
    ...base,
    citation: citationSummary,
    exactMatch,
  };
}
