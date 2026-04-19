import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseSectionsFromFullText } from "@/lib/bill-sections";
import { generateExplainPassage } from "@/lib/ai";
import { assertAiEnabled, AiDisabledError } from "@/lib/ai-gate";
import {
  assertIpRateLimit,
  assertUserRateLimit,
  RateLimitError,
} from "@/lib/rate-limit";
import { recordSpend } from "@/lib/budget";
import { getCachedResponse, setCachedResponse } from "@/lib/ai-cache";
import { reportError } from "@/lib/error-reporting";

/**
 * POST /api/ai/explain-passage
 *
 * The brand-defining moment of the reader: user selects a passage,
 * single tap → 2-second Haiku call → plain-English explanation in a
 * popover. Anonymous users can call this (per the design decision in
 * the plan) so the magical first-touch survives unauthenticated SEO
 * traffic; abuse is bounded by IP rate limit + the global budget gate.
 *
 * Request body:
 *   { billId: number, passage: string, sectionPath: string[] }
 *
 * Response:
 *   200: { explanation: string, model: string, cached: boolean }
 *   400: { error } — validation
 *   404: { error } — section not found in bill text
 *   429: RateLimitError.toJSON()
 *   503: AiDisabledError.toJSON()
 */

export const maxDuration = 60;

const MIN_PASSAGE_LENGTH = 40;
const MAX_PASSAGE_LENGTH = 4000;
const MAX_PER_USER_PER_HOUR = 30;
const MAX_PER_IP_PER_HOUR = 15;

interface RequestBody {
  billId: unknown;
  passage: unknown;
  sectionPath: unknown;
}

export async function POST(request: NextRequest) {
  // ── Validate body ───────────────────────────────────────────────────
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { error: "Malformed request body." },
      { status: 400 },
    );
  }

  const billId =
    typeof body.billId === "number"
      ? body.billId
      : typeof body.billId === "string"
        ? parseInt(body.billId, 10)
        : NaN;
  if (!Number.isInteger(billId) || billId <= 0) {
    return NextResponse.json(
      { error: "billId is required and must be a positive integer." },
      { status: 400 },
    );
  }

  const passageRaw =
    typeof body.passage === "string" ? body.passage.trim() : "";
  if (
    passageRaw.length < MIN_PASSAGE_LENGTH ||
    passageRaw.length > MAX_PASSAGE_LENGTH
  ) {
    return NextResponse.json(
      {
        error: `passage must be between ${MIN_PASSAGE_LENGTH} and ${MAX_PASSAGE_LENGTH} characters.`,
      },
      { status: 400 },
    );
  }

  const sectionPath = Array.isArray(body.sectionPath)
    ? body.sectionPath.filter((s): s is string => typeof s === "string")
    : [];
  if (sectionPath.length === 0) {
    return NextResponse.json(
      { error: "sectionPath is required and must be a non-empty array." },
      { status: 400 },
    );
  }

  try {
    // ── Auth (optional) + rate limits ─────────────────────────────────
    // We don't require sign-in for explain — the magical first-touch
    // for anonymous SEO traffic depends on it. Authed users get the
    // higher limit; anon users get the IP limit. Both honor the
    // global budget gate via assertAiEnabled.
    const userId = await getOptionalUserId();

    if (userId) {
      await assertUserRateLimit(userId, "explain", MAX_PER_USER_PER_HOUR);
    }
    const ip = clientIpFromRequest(request);
    assertIpRateLimit(ip, MAX_PER_IP_PER_HOUR);

    await assertAiEnabled("explain");

    // ── Server-side passage existence check ───────────────────────────
    // The route refuses to "explain" a passage that isn't actually in
    // the named section. Prevents a malicious caller from sending an
    // arbitrary string and getting AI commentary on it via our budget.
    const [bill, latestVersion] = await Promise.all([
      prisma.bill.findUnique({
        where: { id: billId },
        select: { id: true, title: true, fullText: true },
      }),
      prisma.billTextVersion.findFirst({
        where: { billId, fullText: { not: null } },
        orderBy: { versionDate: "desc" },
        select: { fullText: true },
      }),
    ]);

    if (!bill) {
      return NextResponse.json({ error: "bill not found" }, { status: 404 });
    }

    const renderableText = latestVersion?.fullText ?? bill.fullText;
    if (!renderableText) {
      return NextResponse.json(
        { error: "bill text not available" },
        { status: 404 },
      );
    }

    const sections = parseSectionsFromFullText(renderableText);
    const targetHeading = sectionPath.join(" > ");
    const targetSection = sections.find((s) => s.heading === targetHeading);
    if (!targetSection) {
      return NextResponse.json(
        { error: "section not found in bill text" },
        { status: 404 },
      );
    }

    const normalizedPassage = passageRaw.toLowerCase();
    if (!targetSection.content.toLowerCase().includes(normalizedPassage)) {
      return NextResponse.json(
        { error: "passage not found in named section" },
        { status: 400 },
      );
    }

    // ── Cache lookup ─────────────────────────────────────────────────
    // Composite key = "explain:" + passage. The (billId, promptHash)
    // unique constraint already scopes per-bill, so the same passage
    // in a different bill won't share a hit. Section path is NOT in
    // the key — same passage usually has one canonical explanation
    // and we want hit rates as high as possible.
    const cacheKey = `explain:${normalizedPassage}`;
    const cached = await getCachedResponse(billId, cacheKey);
    if (cached) {
      return NextResponse.json({
        explanation: cached.response,
        model: cached.model,
        cached: true,
      });
    }

    // ── Generate ─────────────────────────────────────────────────────
    const { content, usage } = await generateExplainPassage(
      bill.title,
      sectionPath,
      passageRaw,
    );

    // Record spend even if the response was bad — the call cost real
    // tokens. Failing to log spend would let abuse drain the budget
    // invisibly.
    try {
      await recordSpend({
        userId: userId ?? null,
        feature: "explain",
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });
    } catch (err) {
      console.error("[explain-passage] failed to record spend:", err);
    }

    // Cache populated AFTER spend so a partial failure (cache write
    // dies) still leaves the budget accurate.
    if (content.length > 0) {
      try {
        await setCachedResponse(billId, cacheKey, content, usage.model);
      } catch (err) {
        console.error("[explain-passage] cache write failed:", err);
      }
    }

    return NextResponse.json({
      explanation: content,
      model: usage.model,
      cached: false,
    });
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json(error.toJSON(), { status: 429 });
    }
    if (error instanceof AiDisabledError) {
      return NextResponse.json(error.toJSON(), { status: 503 });
    }
    console.error(
      JSON.stringify({
        event: "api_error",
        route: "POST /api/ai/explain-passage",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    reportError(error, { route: "POST /api/ai/explain-passage" });
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Read the auth user without requiring a sign-in. Returns the userId
 * if a session is present, or null otherwise. Doesn't upsert the
 * Profile row — that's the responsibility of authed-only endpoints
 * (and irrelevant here for anonymous calls).
 */
async function getOptionalUserId(): Promise<string | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Best-effort client IP. On Vercel the platform sets x-forwarded-for
 * with the real client IP first in the comma-separated chain; behind
 * other proxies x-real-ip is the conventional fallback. If neither is
 * present we degrade to "unknown" so the in-process IP rate limit
 * collapses all unknown sources to one bucket — conservative.
 */
function clientIpFromRequest(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}
