import "dotenv/config";
import { fetchBillTitles } from "../lib/congress-api";
import { parseBillId } from "../lib/parse-bill-id";
import { createStandalonePrisma } from "../lib/prisma-standalone";

const prisma = createStandalonePrisma();

/**
 * Populate popularTitle / displayTitle / shortTitle on every bill that's
 * missing all three by hitting the Congress.gov `/titles` endpoint. Cheap
 * because it's one API call per bill (vs the 4 that refresh-bill-metadata
 * makes).
 *
 * This is intended to run locally after the title-search migration, so
 * the results flow into data/bill-enrichment.json via backup-data and
 * reach prod through restore-data on next deploy — much faster than
 * drip-feeding via the prod cron.
 *
 * Skippable: any bill that already has any of the three fields set is
 * left alone, so re-running is safe and resumable.
 *
 * Usage:
 *   npx tsx src/scripts/backfill-bill-titles.ts                # all bills
 *   npx tsx src/scripts/backfill-bill-titles.ts --limit 500    # 500 bills
 *   npx tsx src/scripts/backfill-bill-titles.ts --concurrency 8
 */

interface Args {
  limit: number | null;
  concurrency: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let limit: number | null = null;
  let concurrency = 5;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") {
      limit = Number.parseInt(argv[++i] ?? "", 10) || null;
    } else if (argv[i] === "--concurrency") {
      concurrency = Number.parseInt(argv[++i] ?? "", 10) || 5;
    }
  }
  return { limit, concurrency: Math.max(1, Math.min(concurrency, 20)) };
}

async function processBill(bill: {
  id: number;
  billId: string;
}): Promise<"ok" | "no-data" | "parse-fail" | "api-fail"> {
  const { congress, apiBillType, billNumber } = parseBillId(bill.billId);
  if (!congress || !apiBillType || !billNumber) return "parse-fail";

  const titles = await fetchBillTitles(congress, apiBillType, billNumber);
  if (!titles) return "api-fail";

  const hasAny =
    titles.popularTitle || titles.displayTitle || titles.shortTitle;
  if (!hasAny) return "no-data";

  await prisma.bill.update({
    where: { id: bill.id },
    data: {
      popularTitle: titles.popularTitle,
      displayTitle: titles.displayTitle,
      shortTitle: titles.shortTitle,
    },
  });
  return "ok";
}

async function main() {
  const { limit, concurrency } = parseArgs();

  const bills = await prisma.bill.findMany({
    where: {
      AND: [
        { popularTitle: null },
        { displayTitle: null },
        { shortTitle: null },
      ],
    },
    select: { id: true, billId: true },
    orderBy: { introducedDate: "desc" },
    ...(limit ? { take: limit } : {}),
  });

  console.log(
    `[backfill-titles] ${bills.length} bills to process at concurrency=${concurrency}`,
  );

  const stats = { ok: 0, noData: 0, parseFail: 0, apiFail: 0 };
  let processed = 0;

  // Hand-rolled bounded concurrency — p-limit would drag in another dep.
  const queue = [...bills];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const b = queue.shift();
      if (!b) break;
      const result = await processBill(b).catch(() => "api-fail" as const);
      switch (result) {
        case "ok":
          stats.ok++;
          break;
        case "no-data":
          stats.noData++;
          break;
        case "parse-fail":
          stats.parseFail++;
          break;
        case "api-fail":
          stats.apiFail++;
          break;
      }
      processed++;
      if (processed % 100 === 0) {
        console.log(
          `[backfill-titles] ${processed}/${bills.length} — ok:${stats.ok} empty:${stats.noData} api-fail:${stats.apiFail}`,
        );
      }
    }
  });

  await Promise.all(workers);

  console.log(
    `[backfill-titles] done — ${stats.ok} populated, ${stats.noData} empty, ${stats.parseFail} unparsable, ${stats.apiFail} api failures`,
  );
  console.log(
    "[backfill-titles] next: `npx tsx src/scripts/backup-data.ts` then commit data/bill-enrichment.json",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
