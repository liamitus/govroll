import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  embedBill,
  shouldUseRag,
  RAG_BILL_CHAR_THRESHOLD,
} from "@/lib/bill-embeddings";
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
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
  //   1. No embeddings yet for the bill — initial backfill.
  //   2. Latest text version differs from what's embedded — version
  //      changed (new substantive amendment), need to re-embed.
  // We measure "large" on `BillTextVersion.fullText` length, not
  // `Bill.fullText`, because the latter is denormalized and
  // sometimes stale.
  const candidates = await prisma.bill.findMany({
    select: {
      id: true,
      billId: true,
      textVersions: {
        where: { fullText: { not: null } },
        orderBy: { versionDate: "desc" },
        take: 1,
        select: { id: true, fullText: true },
      },
      embeddingChunks: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { textVersionId: true },
      },
    },
    orderBy: { id: "asc" },
  });

  const queue = candidates
    .filter((b) => {
      const v = b.textVersions[0];
      if (!v?.fullText) return false;
      if (!shouldUseRag(v.fullText.length)) return false;
      const existing = b.embeddingChunks?.[0];
      // Embed if no chunks exist OR the latest version differs from
      // what's currently embedded.
      return !existing || existing.textVersionId !== v.id;
    })
    .slice(0, limit);

  const totalRemaining = candidates.filter((b) => {
    const v = b.textVersions[0];
    if (!v?.fullText) return false;
    if (!shouldUseRag(v.fullText.length)) return false;
    const existing = b.embeddingChunks?.[0];
    return !existing || existing.textVersionId !== v.id;
  }).length;

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
      results.push({
        billId: target.billId,
        chunks: result.chunksWritten,
        costCents: result.totalCostCents,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ billId: target.billId, error: msg });
      reportError(err, {
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
