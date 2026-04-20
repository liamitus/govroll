import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createStandalonePrisma } from "../lib/prisma-standalone";

const prisma = createStandalonePrisma();

/**
 * Dump bill enrichment + AI-generated content to git-committable JSON files.
 *
 * Why: Govroll pays real money to generate AI content (Layer 2 change summaries,
 * future Layer 4 explainers). A lost database would mean re-paying. Supabase
 * provides daily backups but only keeps them 7 days on the free tier and
 * evaporates if the Supabase account is lost. Git-committed dumps give us
 * durable, version-controlled, provider-independent recovery.
 *
 * Output:
 *   data/bill-enrichment.json  — free-to-regenerate Congress.gov metadata
 *                                (kept anyway for restore speed + api-shape
 *                                resilience)
 *   data/ai-outputs.json       — AI-generated content that costs money to
 *                                regenerate. This is the critical file.
 *
 * Both are sorted by billId for diffability. Pretty-printed so git diffs
 * are readable and merge conflicts are resolvable.
 *
 * Usage:
 *   npx tsx src/scripts/backup-data.ts              # dump both files
 *   npx tsx src/scripts/backup-data.ts --ai-only    # dump only the AI one
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

interface BackupMetadata {
  generatedAt: string;
  totalBills: number;
  totalAiOutputs: number;
  schemaVersion: number;
}

// v2: added popularTitle, displayTitle, shortTitle from Congress.gov /titles.
const SCHEMA_VERSION = 2;
const DATA_DIR = path.resolve(process.cwd(), "data");

async function backupEnrichment(): Promise<BillEnrichmentRecord[]> {
  const bills = await prisma.bill.findMany({
    where: {
      OR: [
        { shortText: { not: null } },
        { sponsor: { not: null } },
        { policyArea: { not: null } },
        { latestActionText: { not: null } },
        { popularTitle: { not: null } },
        { displayTitle: { not: null } },
        { shortTitle: { not: null } },
      ],
    },
    select: {
      billId: true,
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

  return bills
    .map((b) => ({
      billId: b.billId,
      shortText: b.shortText,
      sponsor: b.sponsor,
      cosponsorCount: b.cosponsorCount,
      cosponsorPartySplit: b.cosponsorPartySplit,
      policyArea: b.policyArea,
      latestActionText: b.latestActionText,
      latestActionDate: b.latestActionDate
        ? b.latestActionDate.toISOString()
        : null,
      popularTitle: b.popularTitle,
      displayTitle: b.displayTitle,
      shortTitle: b.shortTitle,
    }))
    .sort((a, b) => a.billId.localeCompare(b.billId));
}

async function backupAiOutputs(): Promise<AiOutputRecord[]> {
  const versions = await prisma.billTextVersion.findMany({
    where: { changeSummary: { not: null } },
    select: {
      versionCode: true,
      versionType: true,
      versionDate: true,
      changeSummary: true,
      bill: { select: { billId: true } },
    },
  });

  return versions
    .map((v) => ({
      billId: v.bill.billId,
      versionCode: v.versionCode,
      versionType: v.versionType,
      versionDate: v.versionDate.toISOString(),
      // Non-null because of the where clause.
      changeSummary: v.changeSummary!,
    }))
    .sort((a, b) => {
      const billCmp = a.billId.localeCompare(b.billId);
      return billCmp !== 0
        ? billCmp
        : a.versionCode.localeCompare(b.versionCode);
    });
}

async function writeJson(filename: string, data: unknown): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const filepath = path.join(DATA_DIR, filename);
  await writeFile(filepath, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`  wrote ${filepath}`);
}

async function main() {
  const aiOnly = process.argv.includes("--ai-only");

  console.log("Backing up bill data to git-committable JSON…");

  const aiOutputs = await backupAiOutputs();
  let enrichment: BillEnrichmentRecord[] = [];
  if (!aiOnly) {
    enrichment = await backupEnrichment();
  }

  const metadata: BackupMetadata = {
    generatedAt: new Date().toISOString(),
    totalBills: enrichment.length,
    totalAiOutputs: aiOutputs.length,
    schemaVersion: SCHEMA_VERSION,
  };

  if (!aiOnly) {
    await writeJson("bill-enrichment.json", {
      ...metadata,
      totalAiOutputs: undefined,
      bills: enrichment,
    });
  }

  await writeJson("ai-outputs.json", {
    ...metadata,
    totalBills: undefined,
    outputs: aiOutputs,
  });

  console.log(
    `\nDone. ${enrichment.length} bills, ${aiOutputs.length} AI-generated summaries backed up.`,
  );
  console.log(
    "\nNext: commit the data/ directory to git so the backup is durable.",
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
