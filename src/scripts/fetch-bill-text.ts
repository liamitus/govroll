import "dotenv/config";
import {
  fetchAllTextVersions,
  downloadTextFormats,
  parseXmlIntoSections,
  fetchOfficialBillTitle,
  fetchBillMetadata,
} from "../lib/congress-api";
import type { TextVersionMeta } from "../lib/congress-api";
import {
  extractVersionCode,
  isSubstantiveVersion,
} from "../lib/version-helpers";
import { parseBillId } from "../lib/parse-bill-id";
import { createStandalonePrisma } from "../lib/prisma-standalone";
import { fetchBillTextFromGovInfo } from "../lib/govinfo";

const prisma = createStandalonePrisma();

/**
 * Parse raw XML or text into a consolidated fullText string.
 */
async function parseToFullText(
  rawXml: string | null,
  rawText: string | null,
  billId: string,
): Promise<string> {
  let fullText = rawText || "";
  if (rawXml) {
    try {
      const sections = await parseXmlIntoSections(rawXml);
      if (sections.length > 0) {
        fullText = sections
          .map((s) => {
            const heading = s.path.length > 0 ? s.path.join(" > ") + "\n" : "";
            return heading + s.content;
          })
          .join("\n\n");
      }
    } catch {
      console.warn(`XML parse failed for ${billId}, using raw text.`);
    }
  }
  return fullText;
}

/**
 * Fetch bill text versions from congress.gov and store each version.
 * Also updates Bill.fullText with the latest version's text for backward compatibility.
 */
export async function fetchBillTextFunction(targetBillId?: string, limit = 10) {
  console.log(
    `Fetching bill text for: ${targetBillId || `up to ${limit} bills without text`}`,
  );
  try {
    const bills = targetBillId
      ? await prisma.bill.findMany({ where: { billId: targetBillId }, take: 1 })
      : await prisma.bill.findMany({
          where: { fullText: null },
          orderBy: { introducedDate: "desc" },
          take: limit,
        });

    console.log(`Found ${bills.length} bills to process.`);

    for (const bill of bills) {
      // Mark this bill as attempted regardless of what happens below — a
      // parse failure, network error, or just "no text available yet" all
      // count as attempts. Without this, the backfill cursor re-picks the
      // same stuck bills forever and new-bill ingestion starves.
      let attemptRecorded = false;
      const recordAttempt = async () => {
        if (attemptRecorded) return;
        attemptRecorded = true;
        await prisma.bill.update({
          where: { id: bill.id },
          data: { textFetchAttemptedAt: new Date() },
        });
      };

      try {
        const { congress, apiBillType, billNumber } = parseBillId(bill.billId);
        if (!congress || !apiBillType || !billNumber) {
          console.warn(`Skipping bill ${bill.billId} — invalid parse.`);
          await recordAttempt();
          continue;
        }

        // Fire every network call in parallel — title, metadata, Congress.gov
        // /text, and the GovInfo probe. Previously these ran serially: title
        // + metadata → then /text → then (if empty) GovInfo. Running GovInfo
        // speculatively adds ~1s of network when Congress.gov has the text,
        // but saves ~1-2s on the common case where Congress.gov /text returns
        // an empty array for a bill GovInfo has fully published. Given that
        // ~90% of our backlog has empty Congress.gov /text responses, the
        // net effect is fewer seconds per bill and a much higher hit rate.
        const [officialTitle, metadata, allVersions, govInfoResult] =
          await Promise.all([
            fetchOfficialBillTitle(congress, apiBillType, billNumber),
            fetchBillMetadata(congress, apiBillType, billNumber),
            fetchAllTextVersions(congress, apiBillType, billNumber),
            fetchBillTextFromGovInfo(congress, apiBillType, billNumber),
          ]);

        const updates: Record<string, unknown> = {};
        if (
          officialTitle &&
          officialTitle.trim() &&
          officialTitle.trim() !== bill.title.trim()
        ) {
          console.warn(
            `  Title mismatch for ${bill.billId}:\n    stored:   ${bill.title}\n    official: ${officialTitle}\n  Updating stored title to match Congress.gov.`,
          );
          updates.title = officialTitle;
        }
        if (metadata) {
          updates.sponsor = metadata.sponsor;
          updates.cosponsorCount = metadata.cosponsorCount;
          updates.cosponsorPartySplit = metadata.cosponsorPartySplit;
          updates.policyArea = metadata.policyArea;
          updates.latestActionText = metadata.latestActionText;
          updates.latestActionDate = metadata.latestActionDate
            ? new Date(metadata.latestActionDate)
            : null;
          updates.shortText = metadata.shortText;
          updates.popularTitle = metadata.popularTitle;
          updates.displayTitle = metadata.displayTitle;
          updates.shortTitle = metadata.shortTitle;
        }
        if (Object.keys(updates).length > 0) {
          await prisma.bill.update({ where: { id: bill.id }, data: updates });
          if (updates.title) bill.title = updates.title as string;
        }

        if (allVersions.length === 0) {
          // Congress.gov /text returned empty — fall through to the GovInfo
          // result we fetched speculatively above. The congress.gov API's
          // /text endpoint is inconsistent — many published bills return
          // an empty textVersions array even though the XML is available
          // at https://www.govinfo.gov/content/pkg/BILLS-*/xml/*.xml.
          const gi = govInfoResult;
          if (!gi) {
            console.warn(
              `No text versions found for ${bill.billId} on Congress.gov or GovInfo.`,
            );
            await recordAttempt();
            continue;
          }

          // Parse the GovInfo XML through our existing section parser and
          // persist as a BillTextVersion row so subsequent runs skip the
          // expensive fetch.
          let fullText = "";
          try {
            const sections = await parseXmlIntoSections(gi.xml);
            if (sections.length > 0) {
              fullText = sections
                .map((s) => {
                  const heading =
                    s.path.length > 0 ? s.path.join(" > ") + "\n" : "";
                  return heading + s.content;
                })
                .join("\n\n");
            }
          } catch {
            // Fall back to raw xml — the AI can still work with it even
            // unstructured.
            fullText = gi.xml;
          }

          if (!fullText) {
            console.warn(`GovInfo XML parsed empty for ${bill.billId}.`);
            await recordAttempt();
            continue;
          }

          await prisma.billTextVersion.upsert({
            where: {
              billId_versionCode: {
                billId: bill.id,
                versionCode: gi.versionCode,
              },
            },
            update: {
              fullText,
              versionType: gi.versionCode,
              versionDate: new Date(),
            },
            create: {
              billId: bill.id,
              versionCode: gi.versionCode,
              versionType: gi.versionCode,
              versionDate: new Date(),
              fullText,
              isSubstantive: isSubstantiveVersion(gi.versionCode),
            },
          });
          await prisma.bill.update({
            where: { id: bill.id },
            data: { fullText, textFetchAttemptedAt: new Date() },
          });
          attemptRecorded = true;
          console.log(
            `${bill.billId}: recovered via GovInfo (${gi.versionCode.toUpperCase()}, ${fullText.length} chars).`,
          );
          continue;
        }

        let latestFullText = "";
        let newVersionsCount = 0;

        for (const version of allVersions) {
          const versionCode = extractVersionCode(version.formats);
          if (!versionCode) {
            console.warn(
              `Could not extract version code for ${bill.billId} version: ${version.type}`,
            );
            continue;
          }

          // Check if we already have this version
          const existing = await prisma.billTextVersion.findUnique({
            where: { billId_versionCode: { billId: bill.id, versionCode } },
          });

          if (existing?.fullText) {
            // Already have this version with text — skip download, but track for latestFullText
            latestFullText = existing.fullText;
            continue;
          }

          // Download and parse text for this version
          const fullText = await downloadAndParse(version, bill.billId);

          // Upsert the version record
          await prisma.billTextVersion.upsert({
            where: { billId_versionCode: { billId: bill.id, versionCode } },
            update: {
              fullText: fullText || undefined,
              versionType: version.type,
              versionDate: version.date ? new Date(version.date) : new Date(),
            },
            create: {
              billId: bill.id,
              versionCode,
              versionType: version.type,
              versionDate: version.date ? new Date(version.date) : new Date(),
              fullText,
              isSubstantive: isSubstantiveVersion(versionCode),
            },
          });

          if (fullText) latestFullText = fullText;
          newVersionsCount++;

          console.log(
            `  ${versionCode.toUpperCase()} (${version.type}) — ${fullText ? `${fullText.length} chars` : "no text"}`,
          );

          // Rate limit between downloads
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        // Update Bill.fullText with the latest version's text, and stamp
        // the attempt timestamp in the same write to avoid a second update.
        await prisma.bill.update({
          where: { id: bill.id },
          data: {
            ...(latestFullText ? { fullText: latestFullText } : {}),
            textFetchAttemptedAt: new Date(),
          },
        });
        attemptRecorded = true;

        console.log(
          `${bill.billId}: ${allVersions.length} versions total, ${newVersionsCount} new.`,
        );
      } catch (error: unknown) {
        console.error(
          `Error processing bill ${bill.billId}:`,
          error instanceof Error ? error.message : error,
        );
        // Still stamp the attempt so a permanently-broken bill (bad billId,
        // congress.gov 5xx, XML parse crash) doesn't block the queue.
        await recordAttempt().catch(() => {});
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log("Finished fetching bill texts.");
  } catch (error: unknown) {
    console.error(
      "Error in fetchBillText:",
      error instanceof Error ? error.message : error,
    );
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Download text formats for a version and parse into a string.
 */
async function downloadAndParse(
  version: TextVersionMeta,
  billId: string,
): Promise<string | null> {
  // Need a TextVersion-compatible object for downloadTextFormats
  const textVersion = {
    date: version.date || "",
    formats: version.formats,
  };

  const { rawXml, rawText } = await downloadTextFormats(textVersion, billId);
  if (!rawXml && !rawText) return null;

  const fullText = await parseToFullText(rawXml, rawText, billId);
  return fullText || null;
}

if (require.main === module) {
  // Usage:
  //   tsx fetch-bill-text.ts                        → 10 bills without text
  //   tsx fetch-bill-text.ts <billId>               → just that bill
  //   tsx fetch-bill-text.ts --limit 100            → 100 bills without text
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1] || "10", 10) : 10;
  const billId =
    limitIdx === 0
      ? undefined
      : args[0]?.startsWith("--")
        ? undefined
        : args[0];
  fetchBillTextFunction(billId, limit);
}
