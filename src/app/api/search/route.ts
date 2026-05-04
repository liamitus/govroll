import { NextRequest, NextResponse } from "next/server";
import { fetchBillsPage } from "@/lib/queries/bills";
import {
  searchRepresentatives,
  type RepSearchResult,
} from "@/lib/queries/representatives";
import { reportError } from "@/lib/error-reporting";
import type { BillSummary, ParsedCitationSummary } from "@/types";

export interface GlobalSearchResponse {
  query: string;
  representatives: RepSearchResult[];
  bills: BillSummary[];
  /** Set when the query parses as a bill citation ("HR 1234"). */
  citation: ParsedCitationSummary | null;
  /** Direct bill match for the typed citation. */
  exactBill: BillSummary | null;
}

const REP_LIMIT = 5;
const BILL_LIMIT = 5;

/**
 * Header search endpoint. Returns a small grouped payload (members + bills)
 * for the typeahead dropdown. Deliberately combines the two queries into a
 * single round trip so the dropdown isn't waiting on two requests serially.
 *
 * Bill search reuses the canonical fetchBillsPage path with momentum="all"
 * — header search shouldn't hide a famous dead bill someone heard about on
 * the news. Filters (chamber, status, topic) are not exposed; they belong
 * on /bills, not in the global typeahead.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const query = (searchParams.get("q") ?? "").trim();

  if (query.length < 2) {
    return NextResponse.json<GlobalSearchResponse>({
      query,
      representatives: [],
      bills: [],
      citation: null,
      exactBill: null,
    });
  }

  try {
    const [representatives, billsResult] = await Promise.all([
      searchRepresentatives(query, REP_LIMIT),
      fetchBillsPage({
        page: 1,
        limit: BILL_LIMIT,
        chamber: "both",
        status: "",
        momentum: "all",
        sortBy: "relevant",
        search: query,
        topic: "",
      }),
    ]);

    return NextResponse.json<GlobalSearchResponse>({
      query,
      representatives,
      bills: billsResult.bills,
      citation: billsResult.citation,
      exactBill: billsResult.exactMatch,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "api_error",
        route: "GET /api/search",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    reportError(error, { route: "GET /api/search" });
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
