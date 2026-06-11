import { NextRequest, NextResponse } from "next/server";
import {
  fetchBillsPage,
  type BillsChamber,
  type BillsMomentum,
  type BillsSortBy,
} from "@/lib/queries/bills";
import { reportError } from "@/lib/error-reporting";
import { clampLimit, clampPage } from "@/lib/pagination";

const VALID_CHAMBERS = new Set<BillsChamber>(["both", "house", "senate"]);
const VALID_MOMENTUM = new Set<BillsMomentum>(["live", "graveyard", "all"]);
const VALID_SORTS = new Set<BillsSortBy>(["relevant", "latest", "newest"]);

function coerce<T extends string>(
  raw: string | null,
  allowed: Set<T>,
  fallback: T,
): T {
  return raw && (allowed as Set<string>).has(raw) ? (raw as T) : fallback;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const page = clampPage(searchParams.get("page"));
  const limit = clampLimit(searchParams.get("limit"));

  try {
    const data = await fetchBillsPage({
      page,
      limit,
      chamber: coerce(searchParams.get("chamber"), VALID_CHAMBERS, "both"),
      status: searchParams.get("status") ?? "",
      momentum: coerce(searchParams.get("momentum"), VALID_MOMENTUM, "live"),
      sortBy: coerce(searchParams.get("sortBy"), VALID_SORTS, "relevant"),
      search: searchParams.get("search") ?? "",
      topic: searchParams.get("topic") ?? "",
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "api_error",
        route: "GET /api/bills",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    reportError(error, { route: "GET /api/bills" });
    return NextResponse.json(
      { error: "Failed to fetch bills" },
      { status: 500 },
    );
  }
}
