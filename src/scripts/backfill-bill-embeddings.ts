/**
 * Backfill — embed the parsed sections of every "large" bill into
 * `BillEmbeddingChunk` so the chat path's RAG retriever can use them.
 *
 * Usage:
 *   # Dry run on a specific bill (HR 7567 in our test plan):
 *   npx tsx src/scripts/backfill-bill-embeddings.ts --bill-id=12345 --dry-run
 *
 *   # Real run on a single bill:
 *   npx tsx src/scripts/backfill-bill-embeddings.ts --bill-id=12345
 *
 *   # Backfill all large bills, capped at $30 to avoid surprise:
 *   npx tsx src/scripts/backfill-bill-embeddings.ts --max-cost-usd=30
 *
 *   # Re-embed bills whose latest text version changed since they were
 *   # last embedded (incremental mode):
 *   npx tsx src/scripts/backfill-bill-embeddings.ts --incremental
 *
 * Flags:
 *   --bill-id=N         Embed exactly this bill (skips threshold check).
 *   --dry-run           Compute cost + plan, write nothing.
 *   --limit=N           Hard cap on bills processed in this run.
 *   --max-cost-usd=N    Abort when total spend exceeds this. Default 25.
 *   --max-bill-cost-usd=N  Abort if a single bill exceeds this. Default 5.
 *   --incremental       Only embed bills whose latest version is newer
 *                       than their existing chunks' createdAt.
 */
import "dotenv/config";

import { createStandalonePrisma } from "../lib/prisma-standalone";
import {
  embedBill,
  RAG_BILL_CHAR_THRESHOLD,
  shouldUseRag,
} from "../lib/bill-embeddings";

interface Flags {
  billId: number | null;
  dryRun: boolean;
  limit: number | null;
  maxCostCents: number;
  maxBillCostCents: number;
  incremental: boolean;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {
    billId: null,
    dryRun: false,
    limit: null,
    maxCostCents: 2_500, // $25 default — covers full corpus + headroom
    maxBillCostCents: 500, // $5 per bill — would catch a runaway omnibus
    incremental: false,
  };

  for (const arg of argv) {
    if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--incremental") flags.incremental = true;
    else if (arg.startsWith("--bill-id=")) {
      const v = parseInt(arg.split("=")[1], 10);
      if (!Number.isFinite(v)) throw new Error(`Bad --bill-id: ${arg}`);
      flags.billId = v;
    } else if (arg.startsWith("--limit=")) {
      const v = parseInt(arg.split("=")[1], 10);
      if (!Number.isFinite(v)) throw new Error(`Bad --limit: ${arg}`);
      flags.limit = v;
    } else if (arg.startsWith("--max-cost-usd=")) {
      const v = parseFloat(arg.split("=")[1]);
      if (!Number.isFinite(v)) throw new Error(`Bad --max-cost-usd: ${arg}`);
      flags.maxCostCents = Math.round(v * 100);
    } else if (arg.startsWith("--max-bill-cost-usd=")) {
      const v = parseFloat(arg.split("=")[1]);
      if (!Number.isFinite(v))
        throw new Error(`Bad --max-bill-cost-usd: ${arg}`);
      flags.maxBillCostCents = Math.round(v * 100);
    }
  }

  return flags;
}

const prisma = createStandalonePrisma();

async function main() {
  const flags = parseFlags(process.argv.slice(2));

  console.log(
    `[backfill] start mode=${flags.dryRun ? "DRY-RUN" : "LIVE"} ` +
      `caps=$${(flags.maxCostCents / 100).toFixed(2)} (per-bill $${(flags.maxBillCostCents / 100).toFixed(2)})`,
  );

  // ── Pick targets ──────────────────────────────────────────────────
  let targetBillIds: number[] = [];

  if (flags.billId != null) {
    targetBillIds = [flags.billId];
    console.log(`[backfill] target: single bill id=${flags.billId}`);
  } else {
    // Pull ids of bills whose latest text version exceeds the RAG
    // threshold. We measure on `BillTextVersion.fullText` length
    // because Bill.fullText is denormalized + sometimes stale. We do
    // NOT filter on `isSubstantive` — the chat route doesn't either,
    // and many genuinely-large omnibuses (e.g. HR 7567) are flagged
    // non-substantive in their introduced state.
    const candidates = await prisma.bill.findMany({
      select: {
        id: true,
        billId: true,
        textVersions: {
          where: { fullText: { not: null } },
          orderBy: { versionDate: "desc" },
          take: 1,
          select: { id: true, fullText: true, versionDate: true },
        },
        embeddingChunks: flags.incremental
          ? {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { createdAt: true, textVersionId: true },
            }
          : false,
      },
      orderBy: { id: "asc" },
    });

    const filtered = candidates.filter((b) => {
      const v = b.textVersions[0];
      if (!v?.fullText) return false;
      if (!shouldUseRag(v.fullText.length)) return false;
      if (flags.incremental) {
        const existing = b.embeddingChunks?.[0];
        // Embed if no existing rows OR the latest version's id differs
        // from what's currently embedded.
        if (existing && existing.textVersionId === v.id) return false;
      }
      return true;
    });

    targetBillIds = filtered.map((b) => b.id);
    if (flags.limit != null)
      targetBillIds = targetBillIds.slice(0, flags.limit);

    console.log(
      `[backfill] ${candidates.length} bills total, ${filtered.length} above ` +
        `RAG threshold (>${(RAG_BILL_CHAR_THRESHOLD / 1000).toFixed(0)}K chars)` +
        (flags.limit != null
          ? `, processing first ${targetBillIds.length}`
          : ""),
    );
  }

  if (targetBillIds.length === 0) {
    console.log("[backfill] nothing to do");
    return;
  }

  // ── Process ───────────────────────────────────────────────────────
  let runningCostCents = 0;
  let ok = 0;
  let failed = 0;
  let skipped = 0;
  let totalChunks = 0;

  for (const billId of targetBillIds) {
    if (runningCostCents >= flags.maxCostCents) {
      console.warn(
        `[backfill] global cap reached ($${(runningCostCents / 100).toFixed(2)}); halting before bill ${billId}.`,
      );
      break;
    }

    try {
      const result = await embedBill(prisma, billId, {
        dryRun: flags.dryRun,
        maxCostCents: flags.maxBillCostCents,
        onProgress: (msg) => console.log(msg),
      });
      runningCostCents += result.totalCostCents;
      totalChunks += result.chunksWritten;
      if (
        result.chunksWritten === 0 &&
        result.chunksSkipped > 0 &&
        !flags.dryRun
      ) {
        skipped++;
      } else {
        ok++;
      }
      console.log(
        `[backfill] bill ${billId}: chunks=${result.chunksWritten} cost=$${(result.totalCostCents / 100).toFixed(3)} running=$${(runningCostCents / 100).toFixed(2)}`,
      );
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[backfill] bill ${billId}: FAILED — ${msg}`);
    }
  }

  console.log(
    `[backfill] done. ok=${ok} skipped=${skipped} failed=${failed} chunks=${totalChunks} totalCost=$${(runningCostCents / 100).toFixed(2)}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
