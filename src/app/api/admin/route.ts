import { NextRequest, NextResponse } from "next/server";
import { fetchBillsFunction } from "@/scripts/fetch-bills";
import { fetchRepresentativesFunction } from "@/scripts/fetch-representatives";
import { fetchVotesFunction } from "@/scripts/fetch-votes";
import { fetchBillTextFunction } from "@/scripts/fetch-bill-text";
import { fetchBillActionsFunction } from "@/scripts/fetch-bill-actions";
import { generateChangeSummariesFunction } from "@/scripts/generate-change-summaries";
import { timingSafeEqualStr } from "@/lib/timing-safe-equal";

function checkAdminAuth(request: NextRequest): boolean {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) return false;
  const token = request.headers.get("x-api-key");
  return timingSafeEqualStr(token, expected);
}

export async function POST(request: NextRequest) {
  if (!checkAdminAuth(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }
  const { action, billIds, billId } = body;

  try {
    switch (action) {
      case "fetch-bills":
        await fetchBillsFunction(billIds);
        return NextResponse.json({ message: "Bills fetched successfully." });

      case "fetch-representatives":
        await fetchRepresentativesFunction();
        return NextResponse.json({
          message: "Representatives fetched successfully.",
        });

      case "fetch-votes":
        await fetchVotesFunction();
        return NextResponse.json({ message: "Votes fetched successfully." });

      case "fetch-bill-text":
        await fetchBillTextFunction(billId);
        return NextResponse.json({
          message: "Bill text fetched successfully.",
        });

      case "fetch-bill-actions":
        await fetchBillActionsFunction(billIds);
        return NextResponse.json({
          message: "Bill actions fetched and statuses reconciled.",
        });

      case "generate-change-summaries":
        await generateChangeSummariesFunction(
          billId ? parseInt(billId) : undefined,
        );
        return NextResponse.json({
          message: "Change summaries generated.",
        });

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 },
        );
    }
  } catch (error: unknown) {
    console.error(
      "Admin action error:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
