import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getAuthenticatedUserId } from "@/lib/auth";
import { parseSectionsFromFullText } from "@/lib/bill-sections";
import { generateExplainPassage } from "@/lib/ai";
import { assertAiEnabled, AiDisabledError } from "@/lib/ai-gate";
import { assertUserRateLimit, RateLimitError } from "@/lib/rate-limit";
import { recordSpend } from "@/lib/budget";
import { getCachedResponse, setCachedResponse } from "@/lib/ai-cache";
import { reportError } from "@/lib/error-reporting";

/**
 * POST /api/ai/explain-passage
 *
 * User selects a passage in the reader, single tap → ~2-second Haiku
 * call → plain-English explanation in a popover. Auth is required —
 * the original "anonymous SEO moment" rationale was unvalidated and
 * the open route was a free AI endpoint payable from the budget. We
 * can re-enable anonymous access if/when SEO traffic data justifies it.
 *
 * Request body:
 *   { billId: number, passage: string, sectionPath: string[] }
 *
 * Response:
 *   200: { explanation: string, model: string, cached: boolean }
 *   400: { error } — validation
 *   401: { error } — not signed in
 *   404: { error } — section not found in bill text
 *   429: RateLimitError.toJSON()
 *   503: AiDisabledError.toJSON()
 */

export const maxDuration = 60;

const MIN_PASSAGE_LENGTH = 40;
const MAX_PASSAGE_LENGTH = 4000;
const MAX_PER_USER_PER_HOUR = 30;

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

  // ── Auth required ───────────────────────────────────────────────────
  const { userId, error: authError } = await getAuthenticatedUserId();
  if (authError) return authError;

  try {
    await assertUserRateLimit(userId, "explain", MAX_PER_USER_PER_HOUR);
    await assertAiEnabled("explain");

    // ── Server-side passage existence check ───────────────────────────
    // The route refuses to "explain" a passage that isn't actually in
    // the named section. Prevents a malicious caller from sending an
    // arbitrary string and getting AI commentary on it via our budget.
    const [bill, latestVersion] = await Promise.all([
      prisma.bill.findUnique({
        where: { id: billId },
        // Drop fullText from this query — latestVersion below is the
        // canonical source for renderable text. fetch-bill-text writes
        // both Bill.fullText and a BillTextVersion row in lockstep, so
        // pulling Bill.fullText here would just ship the same megabytes
        // twice through the pooler.
        select: { id: true, title: true },
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

    const renderableText = latestVersion?.fullText ?? null;
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
        userId,
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
