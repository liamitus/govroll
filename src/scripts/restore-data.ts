import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createStandalonePrisma } from "../lib/prisma-standalone";

const prisma = createStandalonePrisma();

/**
 * Restore bill enrichment + AI outputs from git-committed JSON backups.
 *
 * Safe to re-run — upserts, never deletes. Only fills in fields that are
 * currently NULL so we never overwrite newer content with older backup data.
 *
 * Pairs with backup-data.ts. See that file for the full rationale.
 *
 * Usage:
 *   npx tsx src/scripts/restore-data.ts            # restore both files
 *   npx tsx src/scripts/restore-data.ts --ai-only  # only AI outputs
 *   npx tsx src/scripts/restore-data.ts --force    # overwrite existing values
 */

interface BillEnrichmentRecord {
  billId: string;
  shortText: string | null;
  sponsor: string | null;
  cosponsorCount: number | null;
  cosponsorPartySplit: string | null;
  policyArea: string | null;
  latestActionText: string | null;
  latestActionDate: string | null;
  popularTitle: string | null;
  displayTitle: string | null;
  shortTitle: string | null;
}

interface AiOutputRecord {
  billId: string;
  versionCode: string;
  versionType: string;
  versionDate: string;
  changeSummary: string;
}

const DATA_DIR = path.resolve(process.cwd(), "data");

async function readJson<T>(filename: string): Promise<T> {
  const filepath = path.join(DATA_DIR, filename);
  const raw = await readFile(filepath, "utf8");
  return JSON.parse(raw) as T;
}

async function restoreEnrichment(force: boolean): Promise<number> {
  const { bills } = await readJson<{ bills: BillEnrichmentRecord[] }>(
    "bill-enrichment.json",
  );
  let restored = 0;

  for (const b of bills) {
    const existing = await prisma.bill.findUnique({
      where: { billId: b.billId },
      select: {
        id: true,
        shortText: true,
        sponsor: true,
        cosponsorCount: true,
        cosponsorPartySplit: true,
        policyArea: true,
        latestActionText: true,
        latestActionDate: true,
        popularTitle: true,
        displayTitle: true,
        shortTitle: true,
      },
    });
    if (!existing) continue;

    const data: Record<string, unknown> = {};
    // Only fill in currently-null fields unless --force is passed.
    if (force || existing.shortText === null) data.shortText = b.shortText;
    if (force || existing.sponsor === null) data.sponsor = b.sponsor;
    if (force || existing.cosponsorCount === null)
      data.cosponsorCount = b.cosponsorCount;
    if (force || existing.cosponsorPartySplit === null)
      data.cosponsorPartySplit = b.cosponsorPartySplit;
    if (force || existing.policyArea === null) data.policyArea = b.policyArea;
    if (force || existing.latestActionText === null)
      data.latestActionText = b.latestActionText;
    if (force || existing.latestActionDate === null) {
      data.latestActionDate = b.latestActionDate
        ? new Date(b.latestActionDate)
        : null;
    }
    if (force || existing.popularTitle === null)
      data.popularTitle = b.popularTitle;
    if (force || existing.displayTitle === null)
      data.displayTitle = b.displayTitle;
    if (force || existing.shortTitle === null) data.shortTitle = b.shortTitle;

    if (Object.keys(data).length > 0) {
      await prisma.bill.update({ where: { id: existing.id }, data });
      restored++;
    }
  }

  return restored;
}

async function restoreAiOutputs(force: boolean): Promise<number> {
  const { outputs } = await readJson<{ outputs: AiOutputRecord[] }>(
    "ai-outputs.json",
  );
  let restored = 0;

  for (const o of outputs) {
    const bill = await prisma.bill.findUnique({
      where: { billId: o.billId },
      select: { id: true },
    });
    if (!bill) continue;

    const existing = await prisma.billTextVersion.findUnique({
      where: {
        billId_versionCode: { billId: bill.id, versionCode: o.versionCode },
      },
      select: { id: true, changeSummary: true },
    });

    if (existing) {
      if (!force && existing.changeSummary !== null) continue;
      await prisma.billTextVersion.update({
        where: { id: existing.id },
        data: { changeSummary: o.changeSummary },
      });
      restored++;
    } else {
      // Version doesn't exist locally yet — create it with the backup data.
      // fullText stays null; text can be re-downloaded from Congress.gov.
      await prisma.billTextVersion.create({
        data: {
          billId: bill.id,
          versionCode: o.versionCode,
          versionType: o.versionType,
          versionDate: new Date(o.versionDate),
          changeSummary: o.changeSummary,
        },
      });
      restored++;
    }
  }

  return restored;
}

async function main() {
  const aiOnly = process.argv.includes("--ai-only");
  const force = process.argv.includes("--force");

  console.log(
    `Restoring from data/…${force ? " (FORCE: will overwrite existing values)" : ""}`,
  );

  let enrichmentCount = 0;
  if (!aiOnly) {
    enrichmentCount = await restoreEnrichment(force);
    console.log(`  enrichment: ${enrichmentCount} bills updated`);
  }

  const aiCount = await restoreAiOutputs(force);
  console.log(`  ai outputs: ${aiCount} rows restored`);

  console.log("\nDone.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
