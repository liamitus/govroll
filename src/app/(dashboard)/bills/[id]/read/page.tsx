import { after } from "next/server";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { parseSectionsFromFullText } from "@/lib/bill-sections";
import { sectionSlugsForBill, pathFromHeading } from "@/lib/section-slug";
import { generateSectionCaptions } from "@/lib/section-caption";
import { maybeFetchBillTextInBackground } from "@/lib/on-demand-bill-text";
import { AiDisabledError } from "@/lib/ai-gate";

import { BillReader } from "@/components/bills/reader/bill-reader";
import { TextNotAvailable } from "@/components/bills/reader/text-not-available";
import type {
  ReaderSection,
  ReaderVersionMeta,
} from "@/components/bills/reader/reader-types";
import type { SectionCaption } from "@/lib/section-caption";

/**
 * Bill text reader at `/bills/[id]/read`. Sibling to the engagement
 * page at `/bills/[id]` — the detail page links to here via a
 * prominent "Read full text →" card. Conversation state is shared
 * with the detail page via the existing per-bill chat API (no extra
 * wiring needed; both pages mount the same `<AiChatbox>`).
 *
 * Day 3-4 scope: full SSR of the parsed bill text with deep-link
 * scrolling. No outline rail, no sticky breadcrumb, no selection
 * popover yet — those land Day 5–7. Captions hydrate via `after()`
 * on first visit, so the first visitor sees raw section paths and
 * the second visitor sees AI captions.
 */

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────
//  Metadata (SEO — the reader is the SEO play)
// ─────────────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const bill = await prisma.bill.findUnique({
    where: { id: parseInt(id, 10) },
    select: { id: true, title: true, shortText: true },
  });

  if (!bill) {
    return { title: "Bill not found — Govroll" };
  }

  const title = `${bill.title} — Full text — Govroll`;
  const description =
    bill.shortText?.slice(0, 200) ??
    `Read the full text of ${bill.title} with plain-English section captions and AI explanations.`;
  const canonical = `/bills/${bill.id}/read`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      siteName: "Govroll",
      type: "article",
      url: canonical,
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
//  Page
// ─────────────────────────────────────────────────────────────────────────

export default async function BillReaderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const { id } = await params;
  const { section: initialSlug } = await searchParams;
  const billId = parseInt(id, 10);

  if (Number.isNaN(billId)) notFound();

  // Single Promise.all — bill metadata for title/sponsor, latest
  // text-bearing version for actual rendering, and the version list
  // (for a future version switcher; loaded now so we don't pay a
  // round trip when we add it).
  const [bill, latestVersion, allVersions] = await Promise.all([
    prisma.bill.findUnique({
      where: { id: billId },
      select: {
        id: true,
        billId: true,
        title: true,
        billType: true,
        link: true,
        fullText: true,
        textFetchAttemptedAt: true,
      },
    }),
    prisma.billTextVersion.findFirst({
      where: { billId, fullText: { not: null } },
      orderBy: { versionDate: "desc" },
      select: {
        id: true,
        versionCode: true,
        versionType: true,
        versionDate: true,
        fullText: true,
        sectionCaptions: true,
        isSubstantive: true,
      },
    }),
    prisma.billTextVersion.findMany({
      where: { billId },
      orderBy: { versionDate: "asc" },
      select: {
        id: true,
        versionCode: true,
        versionType: true,
        versionDate: true,
        isSubstantive: true,
      },
    }),
  ]);

  if (!bill) notFound();

  // No version with text yet. Try the legacy `Bill.fullText` fallback
  // (some older bills have text on the parent row but no version row).
  // If still nothing, kick a background fetch and render the friendly
  // "fetching" state.
  const renderableText = latestVersion?.fullText ?? bill.fullText;
  if (!renderableText) {
    maybeFetchBillTextInBackground({
      id: bill.id,
      billId: bill.billId,
      fullText: bill.fullText,
      textFetchAttemptedAt: bill.textFetchAttemptedAt,
    });
    return <TextNotAvailable bill={bill} />;
  }

  const parsedSections = parseSectionsFromFullText(renderableText);
  if (parsedSections.length === 0) {
    return <TextNotAvailable bill={bill} />;
  }

  const slugs = sectionSlugsForBill(parsedSections);
  const captions: SectionCaption[] = Array.isArray(
    latestVersion?.sectionCaptions,
  )
    ? (latestVersion.sectionCaptions as unknown as SectionCaption[])
    : [];
  const captionMap = new Map(captions.map((c) => [c.sectionId, c.caption]));

  const sections: ReaderSection[] = parsedSections.map((s, i) => ({
    ...s,
    slug: slugs[i],
    depth: pathFromHeading(s.heading).length,
    caption: captionMap.get(slugs[i]) ?? null,
  }));

  // Lazy caption generation. `after()` runs after the response is
  // sent so the first reader doesn't wait. AiDisabledError is the
  // expected failure when the monthly budget is exhausted — swallow
  // it. `revalidatePath` makes the next visit see captions.
  if (latestVersion && latestVersion.sectionCaptions === null) {
    const versionIdToCaption = latestVersion.id;
    const billPathToRevalidate = `/bills/${bill.id}/read`;
    after(async () => {
      try {
        const result = await generateSectionCaptions(versionIdToCaption);
        if (result.captions.length > 0) {
          revalidatePath(billPathToRevalidate);
        }
      } catch (err) {
        if (err instanceof AiDisabledError) {
          // Budget gate closed. Bill renders without captions.
          return;
        }
        console.error(
          "[reader] caption generation failed for version",
          versionIdToCaption,
          err,
        );
      }
    });
  }

  // Build the version meta passed to the shell. If the only text we
  // have is the legacy Bill.fullText, synthesize a minimal version
  // record so the header doesn't crash.
  const versionMeta: ReaderVersionMeta = latestVersion
    ? {
        id: latestVersion.id,
        versionCode: latestVersion.versionCode,
        versionType: latestVersion.versionType,
        versionDate: latestVersion.versionDate,
        isSubstantive: latestVersion.isSubstantive,
      }
    : {
        id: -1,
        versionCode: "legacy",
        versionType: "Bill text",
        versionDate: new Date(),
        isSubstantive: true,
      };

  // Used by the (future) version switcher; keep the query alive so
  // we don't pay a second round trip when we wire it up.
  void allVersions;

  return (
    <BillReader
      bill={{
        id: bill.id,
        billId: bill.billId,
        title: bill.title,
        billType: bill.billType,
      }}
      version={versionMeta}
      sections={sections}
      initialSlug={initialSlug ?? null}
    />
  );
}
