import { NextRequest, NextResponse } from "next/server";
import { reportError } from "@/lib/error-reporting";

/**
 * POST /api/errors/report
 *
 * Receives client-side error reports from the global error boundary
 * and forwards them through the email alerting pipeline.
 *
 * This endpoint is unauthenticated (the error boundary has no credential to
 * present). Two abuse mitigations apply: reportError buckets `source: "client"`
 * into a small, SEPARATE hourly budget so a flood here can't suppress genuine
 * server alerts, and we clamp the untrusted message/stack lengths below so a
 * single giant payload can't bloat the alert email.
 */
const MAX_CLIENT_MESSAGE_LEN = 500;
const MAX_CLIENT_STACK_LEN = 4000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, stack, digest } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }

    const error = new Error(message.slice(0, MAX_CLIENT_MESSAGE_LEN));
    error.stack =
      typeof stack === "string"
        ? stack.slice(0, MAX_CLIENT_STACK_LEN)
        : undefined;

    await reportError(error, {
      source: "client",
      digest: typeof digest === "string" ? digest.slice(0, 200) : undefined,
      url: request.headers.get("referer") || undefined,
      ua: request.headers.get("user-agent") || undefined,
    });
  } catch {
    // Silently swallow — error reporting should never fail loudly
  }

  return NextResponse.json({ ok: true });
}
