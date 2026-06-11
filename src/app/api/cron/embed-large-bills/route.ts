import { NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/timing-safe-equal";
import { prisma } from "@/lib/prisma";
import {
  embedBill,
  HAIKU_MODEL,
  RAG_BILL_CHAR_THRESHOLD,
  type EmbedBillResult,
} from "@/lib/bill-embeddings";
import { VOYAGE_EMBED_MODEL } from "@/lib/voyage";
import { recordSpend } from "@/lib/budget";
import { assertAiEnabled, AiDisabledError } from "@/lib/ai-gate";
import { reportError } from "@/lib/error-reporting";

/**
 * GET /api/cron/embed-large-bills
 *
 * Incremental RAG embedding for "large" bills — those whose latest
 * text version exceeds the in-context budget so the chat path needs
 * vector retrieval instead of inlining the full text. Picks the next
 * few bills that either have no embeddings yet, or whose latest
 * version is newer than what's currently embedded, processes them
 * sequentially within a budget, and returns the running queue depth.
 *
 * Initial corpus backfill is done via `scripts/backfill-bill-embeddings.ts`
 * (locally, off-cron — much faster on a stable connection). This cron
 * exists for steady-state: as Congress posts new bill versions, we
 * trickle them into the embedding table so RAG quality stays current.
 *
 * Idempotent — `embedBill` deletes existing rows for the
 * (billId, textVersionId) tuple before inserting. Safe to run
 * concurrently with manual backfills (each handles its own bills).
 *
 * Protected by CRON_SECRET. Default schedule (see ingest.yml) is
 * every 30 min; manual `?limit=N` override available for catch-up runs.
 */

// Each bill takes 30-90s end-to-end (Voyage embedding + DB writes).
// 250s budget at 3 bills/run keeps us safely under the 300s Fluid
// Compute ceiling.
export const maxDuration = 300;
const TIMEOUT_MS = 250_000;
const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 10;

/** Per-bill cost cap for the cron. The local backfill script uses $5
 *  but we tighten here because cron failures are harder to notice and
 *  a runaway omnibus could drain budget unattended. */
const PER_BILL_COST_CAP_CENTS = 200;

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const auth = request.headers.get("authorization");
  if (!timingSafeEqualStr(auth, `Bearer ${expected}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ── Budget gate ───────────────────────────────────────────────────
  // Embedding spends real money (Voyage + optional Haiku context), so —
  // like every other generate-* cron — it pauses when AI is budget- or
  // manually-disabled instead of draining the ledger unattended. Checked
  // before the candidate scan so a disabled run also skips that DB work.
  try {
    await assertAiEnabled("embedding");
  } catch (e) {
    if (e instanceof AiDisabledError) {
      console.log(`[embed-large-bills] AI disabled, skipping: ${e.reason}`);
      return NextResponse.json({
        ok: true,
        skipped: "ai_disabled",
        reason: e.reason,
      });
    }
    throw e;
  }

  const url = new URL(request.url);
  const limit = Math.min(
    MAX_LIMIT,
    parseInt(url.searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10),
  );

  const started = Date.now();
  const deadline = started + TIMEOUT_MS;

  // ── Pick the next bills that need (re-)embedding ──────────────────
  // Two cases:
  //   1. No completion marker yet — initial backfill (covers the
  //      partial-write recovery case: chunks exist but the marker is
  //      still null because the last chunk didn't land).
  //   2. Latest text version differs from `embeddingsTextVersionId` —
  //      version changed (new amendment), need to re-embed.
  //
  // Filtering happens in SQL via $queryRaw so we don't pull every
  // bill's fullText across the wire just to compare a length and an
  // id. With Prisma's findMany + JS filter this query alone burned
  // ~14 GB/day of Supabase egress. embedBill re-fetches the text it
  // needs for the (at most `limit`) bills we actually process.
  //
  // The size test reads the precomputed `textLength` column rather than
  // `LENGTH(v."fullText")`. The old `LENGTH(...)` detoasted every bill's
  // latest fullText on every run (~12-15s, ~10% of total DB time across
  // 48 runs/day) just to compare a number. `textLength` is written at
  // ingest (fetch-bill-text) and lives inline, so no toast fetch.
  // `"fullText" IS NOT NULL` stays — it's a cheap null-bitmap check, not
  // a detoast — so we still pick the latest version that actually has text.
  const candidates = await prisma.$queryRaw<
    Array<{ id: number; billId: string }>
  >`
    SELECT b.id, b."billId"
    FROM "Bill" b
    INNER JOIN LATERAL (
      SELECT id, "textLength"
      FROM "BillTextVersion"
      WHERE "billId" = b.id AND "fullText" IS NOT NULL
      ORDER BY "versionDate" DESC
      LIMIT 1
    ) v ON TRUE
    WHERE v."textLength" > ${RAG_BILL_CHAR_THRESHOLD}
      AND (b."embeddingsTextVersionId" IS NULL
           OR b."embeddingsTextVersionId" <> v.id)
    ORDER BY b.id ASC
  `;

  const totalRemaining = candidates.length;
  const queue = candidates.slice(0, limit);

  // ── Process sequentially, respecting deadline ─────────────────────
  const results: Array<{
    billId: string;
    chunks?: number;
    costCents?: number;
    skipped?: boolean;
    error?: string;
  }> = [];

  for (const target of queue) {
    if (Date.now() >= deadline) {
      results.push({ billId: target.billId, skipped: true });
      continue;
    }
    try {
      const result = await embedBill(prisma, target.id, {
        // Skip contextual prefixes for the cron path. The corpus
        // backfill skips them too; they'd require Anthropic Tier 2+
        // throughput or batch API to sustain. Re-add later if
        // retrieval misses surface in the chat_context_truncated log.
        skipContext: true,
        maxCostCents: PER_BILL_COST_CAP_CENTS,
      });
      // Book the spend embedBill just incurred against the budget ledger.
      await recordEmbeddingSpend(result);
      results.push({
        billId: target.billId,
        chunks: result.chunksWritten,
        costCents: result.totalCostCents,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ billId: target.billId, error: msg });
      // Await: a fire-and-forget reportError can be frozen by Vercel when the
      // function returns before the Resend fetch resolves, dropping the alert.
      await reportError(err, {
        route: "GET /api/cron/embed-large-bills",
        billId: target.billId,
      });
    }
  }

  const elapsedMs = Date.now() - started;
  const processed = results.filter((r) => r.chunks != null).length;
  const errorCount = results.filter((r) => r.error).length;
  const skippedCount = results.filter((r) => r.skipped).length;

  return NextResponse.json({
    ok: true,
    processed,
    errorCount,
    skippedCount,
    results,
    remaining: Math.max(0, totalRemaining - processed),
    threshold: RAG_BILL_CHAR_THRESHOLD,
    elapsedMs,
    elapsedSec: Math.round(elapsedMs / 1000),
  });
}

/**
 * Book a bill's embedding spend against the budget ledger. `embedBill`
 * computes the cost but — being a pure pipeline that takes an injected
 * client — deliberately doesn't touch the ledger, so the cron records it
 * here. Without this the pipeline spent Voyage (and, with context, Haiku)
 * money entirely off-ledger: invisible to the budget gate and able to
 * keep running after AI was disabled.
 *
 * Spend is split by model so usage reports attribute Voyage embeddings
 * vs. Haiku context separately. Soft-fails: the bill is already embedded
 * and durable, so a transient ledger-write error must not fail the run
 * (we report it so the gap is visible rather than silent).
 */
async function recordEmbeddingSpend(result: EmbedBillResult): Promise<void> {
  try {
    if (result.voyageTokens > 0) {
      await recordSpend({
        feature: "embedding",
        model: VOYAGE_EMBED_MODEL,
        inputTokens: result.voyageTokens,
        outputTokens: 0,
      });
    }
    // The cron runs skipContext=true, so normally there are no Haiku
    // context tokens — but record them whenever present so re-enabling the
    // contextual-retrieval stage can never silently put spend off-ledger.
    if (result.haikuInputTokens > 0 || result.haikuOutputTokens > 0) {
      await recordSpend({
        feature: "embedding",
        model: HAIKU_MODEL,
        inputTokens: result.haikuInputTokens,
        outputTokens: result.haikuOutputTokens,
      });
    }
  } catch (err) {
    console.error(
      "[embed-large-bills] failed to record embedding spend:",
      err instanceof Error ? err.message : err,
    );
    reportError(err, {
      route: "GET /api/cron/embed-large-bills recordSpend",
    });
  }
}
