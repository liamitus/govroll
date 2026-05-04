import { NextRequest, NextResponse } from "next/server";
import { getRepresentativesByAddress } from "@/lib/civic-api";
import { reportError } from "@/lib/error-reporting";

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
  const { address } = body;

  if (!address) {
    return NextResponse.json({ error: "Address is required" }, { status: 400 });
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
    return NextResponse.json({
      representatives: data.officials,
      state: data.state,
      district: data.district,
    });
  } catch (error) {
    console.error("Error fetching representatives by address:", error);
    reportError(error, {
      route: "POST /api/representatives/by-address",
      addressLength: typeof address === "string" ? address.length : 0,
    });
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to look up representatives",
      },
      { status: 500 },
    );
  }
}
