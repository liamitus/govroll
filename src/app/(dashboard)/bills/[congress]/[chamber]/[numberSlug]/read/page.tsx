import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { parseSectionsFromFullText } from "@/lib/bill-sections";
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
export const dynamic = "force-dynamic";

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
    select: { billId: true, title: true, shortText: true },
  });

  if (!bill) {
    return { title: "Bill not found — Govroll" };
  }

  const title = `${bill.title} — Full text — Govroll`;
  const description =
    bill.shortText?.slice(0, 200) ??
    `Read the full text of ${bill.title} with plain-English section captions and AI explanations.`;
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
  const [bill, latestVersion, allVersions] = await Promise.all([
    prisma.bill.findUnique({
      where: { billId: billIdKey },
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

  // Canonicalize the URL.
  const canonicalReadHref = billReadHref({
    billId: bill.billId,
    title: bill.title,
  });
  const currentPath = `/bills/${congress}/${chamber}/${numberSlug}/read`;
  if (!parsed.canonical || currentPath !== canonicalReadHref) {
    permanentRedirect(canonicalReadHref);
  }

  // No version with text yet. Try the legacy `Bill.fullText` fallback
  // (some older bills have text on the parent row but no version row).
  // If still nothing, kick a background fetch and render the friendly
  // "fetching" state.
  const renderableText = latestVersion?.fullText ?? bill.fullText;
  if (!renderableText) {
    maybeFetchBillTextInBackground({
      id: bill.id,
      billId: bill.billId,
      title: bill.title,
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
        govtrackUrl: bill.link ?? null,
      }}
      version={versionMeta}
      sections={sections}
      initialSlug={initialSlug ?? null}
    />
  );
}
