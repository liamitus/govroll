import { NextRequest, NextResponse } from "next/server";
import { getRepresentativesByAddress } from "@/lib/civic-api";
import { reportError } from "@/lib/error-reporting";
import {
  assertIpRateLimit,
  getClientIp,
  RateLimitError,
} from "@/lib/rate-limit";

/** Per-IP ceiling on address lookups per hour. Each distinct address is a
 *  fresh billed geocode (repeats are served from the in-process cache), so
 *  this caps a single source looping addresses while staying generous for a
 *  real user browsing many bills with their saved address. */
const MAX_REP_LOOKUPS_PER_IP_PER_HOUR = 60;

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
    assertIpRateLimit(getClientIp(request), MAX_REP_LOOKUPS_PER_IP_PER_HOUR);
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(err.toJSON(), {
        status: 429,
        headers: { "Retry-After": String(err.retryAfterSeconds) },
      });
    }
    throw err;
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
    // Don't echo error.message — it can leak geocoder/Prisma internals. The
    // full error is logged + reported above for debugging.
    return NextResponse.json(
      { error: "Failed to look up representatives" },
      { status: 500 },
    );
  }
}
