import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { parseSectionsFromFullText } from "@/lib/bill-sections";
import { pickBillHeadline } from "@/lib/bill-headline";
import { sectionSlugsForBill, pathFromHeading } from "@/lib/section-slug";
import { maybeFetchBillTextInBackground } from "@/lib/on-demand-bill-text";
import {
  billReadHref,
  billIdentifierFor,
  parseBillPath,
} from "@/lib/bills/url";

import { BillReader } from "@/components/bills/reader/bill-reader";
import { TextNotAvailable } from "@/components/bills/reader/text-not-available";
import type {
  ReaderSection,
  ReaderVersionMeta,
} from "@/components/bills/reader/reader-types";
import type { SectionCaption } from "@/lib/section-caption";

/**
 * Bill text reader at `/bills/[congress]/[chamber]/[numberSlug]/read`.
 * Sibling to the engagement page at the parent URL — the detail page
 * links to here via a prominent "Read full text →" card. Conversation
 * state is shared with the detail page via the existing per-bill chat
 * API (no extra wiring needed; both pages mount the same `<AiChatbox>`).
 */

// `loading.tsx` was intentionally omitted from this route. When a sibling
// `loading.tsx` is present, Next.js wraps this page in a Suspense boundary
// that swallows the redirect thrown by `permanentRedirect` during the
// non-canonical URL check below — the request ends up returning 200 with
// the page body instead of a 308. Cold SSR without a loading skeleton is
// fast enough here that the UX cost is marginal; keeping the redirects
// working on the reader route matters more for SEO.
//
// ISR with a 1-hour revalidate window: bill text rarely changes within
// an hour (new versions arrive infrequently and via the hourly backfill
// cron). Caching the rendered page avoids shipping multi-MB fullText
// rows through the Postgres pooler on every visitor — the dominant
// source of pre-fix egress. Redirects still work under ISR: a
// non-canonical URL renders, hits permanentRedirect, and the 308
// response is what gets cached for that URL.
export const revalidate = 3600;

type RouteParams = Promise<{
  congress: string;
  chamber: string;
  numberSlug: string;
}>;

// ─────────────────────────────────────────────────────────────────────────
//  Metadata (SEO — the reader is the SEO play)
// ─────────────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: RouteParams;
}): Promise<Metadata> {
  const { congress, chamber, numberSlug } = await params;
  const parsed = parseBillPath([congress, chamber, numberSlug]);
  if (!parsed) return { title: "Bill not found — Govroll" };

  const billIdKey = billIdentifierFor(
    parsed.chamberCode,
    parsed.number,
    parsed.congress,
  );
  if (!billIdKey) return { title: "Bill not found — Govroll" };

  const bill = await prisma.bill.findUnique({
    where: { billId: billIdKey },
    select: {
      billId: true,
      title: true,
      shortText: true,
      // Title-fallback fields so the browser tab on the reader matches
      // the headline the user sees, not the raw 600-word title.
      popularTitle: true,
      shortTitle: true,
      displayTitle: true,
      aiShortDescription: true,
    },
  });

  if (!bill) {
    return { title: "Bill not found — Govroll" };
  }

  const headline = pickBillHeadline(bill).headline;
  const title = `${headline} — Full text — Govroll`;
  const description =
    bill.shortText?.slice(0, 200) ??
    `Read the full text of ${headline} with plain-English section captions and AI explanations.`;
  const canonical = billReadHref({ billId: bill.billId, title: bill.title });

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
  params: RouteParams;
  searchParams: Promise<{ section?: string }>;
}) {
  const { congress, chamber, numberSlug } = await params;
  const { section: initialSlug } = await searchParams;

  const parsed = parseBillPath([congress, chamber, numberSlug]);
  if (!parsed) notFound();

  const billIdKey = billIdentifierFor(
    parsed.chamberCode,
    parsed.number,
    parsed.congress,
  );
  if (!billIdKey) notFound();

  // Single Promise.all — bill metadata for title/sponsor, latest
  // text-bearing version for actual rendering, and the version list
  // (for a future version switcher; loaded now so we don't pay a
  // round trip when we add it).
  //
  // Bill.fullText is intentionally omitted: fetch-bill-text writes both
  // Bill.fullText and a BillTextVersion row in lockstep, so latestVersion
  // is the canonical source. The handful of legacy bills with only
  // Bill.fullText fall through to the conditional fallback below.
  const [bill, latestVersion, allVersions] = await Promise.all([
    prisma.bill.findUnique({
      where: { billId: billIdKey },
      select: {
        id: true,
        billId: true,
        title: true,
        billType: true,
        link: true,
        textFetchAttemptedAt: true,
        // Title-fallback fields for pickBillHeadline. The reader's H1,
        // sticky breadcrumb, and "text not yet available" page all use
        // the resolved headline rather than the raw title.
        shortText: true,
        popularTitle: true,
        shortTitle: true,
        displayTitle: true,
        aiShortDescription: true,
        _count: {
          select: {
            textVersions: { where: { fullText: { not: null } } },
          },
        },
      },
    }),
    prisma.billTextVersion.findFirst({
      where: { bill: { billId: billIdKey }, fullText: { not: null } },
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
      where: { bill: { billId: billIdKey } },
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

  // Resolve the display headline once — used by the reader header, the
  // sticky breadcrumb, and the "text not yet available" fallback. All
  // of these previously rendered the raw title, which for rule
  // resolutions could run several hundred words.
  const headline = pickBillHeadline(bill).headline;

  // Canonicalize the URL.
  const canonicalReadHref = billReadHref({
    billId: bill.billId,
    title: bill.title,
  });
  const currentPath = `/bills/${congress}/${chamber}/${numberSlug}/read`;
  if (!parsed.canonical || currentPath !== canonicalReadHref) {
    permanentRedirect(canonicalReadHref);
  }

  // Resolve renderable text. Common path: latestVersion has it. Rare
  // legacy path: no BillTextVersion row but Bill.fullText is populated
  // (bills ingested before the version model existed). Pay the extra
  // round trip only on that rare path so common visits stay cheap.
  let renderableText: string | null = latestVersion?.fullText ?? null;
  if (!renderableText) {
    const legacyText = await prisma.bill.findUnique({
      where: { id: bill.id },
      select: { fullText: true },
    });
    renderableText = legacyText?.fullText ?? null;
  }

  if (!renderableText) {
    maybeFetchBillTextInBackground({
      id: bill.id,
      billId: bill.billId,
      title: bill.title,
      hasFullText: bill._count.textVersions > 0,
      textFetchAttemptedAt: bill.textFetchAttemptedAt,
    });
    return <TextNotAvailable bill={{ ...bill, headline }} />;
  }

  const parsedSections = parseSectionsFromFullText(renderableText);
  if (parsedSections.length === 0) {
    return <TextNotAvailable bill={{ ...bill, headline }} />;
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
        headline,
        billType: bill.billType,
        govtrackUrl: bill.link ?? null,
      }}
      version={versionMeta}
      sections={sections}
      initialSlug={initialSlug ?? null}
    />
  );
}
