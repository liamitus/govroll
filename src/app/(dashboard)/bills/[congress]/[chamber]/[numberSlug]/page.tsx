import { prisma } from "@/lib/prisma";
import { notFound, permanentRedirect } from "next/navigation";
import dayjs from "dayjs";
import {
  getBillTypeInfo,
  getJourneySteps,
  getStatusExplanation,
  getEffectiveStatus,
  buildDynamicJourney,
} from "@/lib/bill-helpers";
import { BillAboutSection } from "@/components/bills/bill-about-section";
import { SponsorCard } from "@/components/bills/sponsor-card";
import { BillDetailInteractive } from "./interactive";
import { parseSponsorString, partyCodeToNames } from "@/lib/sponsor";
import { maybeFetchBillTextInBackground } from "@/lib/on-demand-bill-text";
import {
  billHref,
  billReadHref,
  billIdentifierFor,
  parseBillPath,
} from "@/lib/bills/url";
import type { MomentumTier, DeathReason } from "@/types";

type RouteParams = Promise<{
  congress: string;
  chamber: string;
  numberSlug: string;
}>;

async function resolveBill(params: RouteParams) {
  const { congress, chamber, numberSlug } = await params;
  const parsed = parseBillPath([congress, chamber, numberSlug]);
  if (!parsed) return { bill: null, parsed: null } as const;

  const billIdKey = billIdentifierFor(
    parsed.chamberCode,
    parsed.number,
    parsed.congress,
  );
  if (!billIdKey) return { bill: null, parsed } as const;

  const bill = await prisma.bill.findUnique({
    where: { billId: billIdKey },
    select: {
      id: true,
      billId: true,
      title: true,
      shortText: true,
    },
  });

  return { bill, parsed } as const;
}

export async function generateMetadata({ params }: { params: RouteParams }) {
  const { bill } = await resolveBill(params);

  const title = bill ? `${bill.title} — Govroll` : "Bill — Govroll";
  const description =
    bill?.shortText ??
    "Track this bill, see how your representatives voted, and share your opinion.";
  const canonical = bill
    ? billHref({ billId: bill.billId, title: bill.title })
    : undefined;

  return {
    title,
    description,
    alternates: canonical ? { canonical } : undefined,
    openGraph: {
      title,
      description,
      siteName: "Govroll",
      type: "article",
      ...(canonical ? { url: canonical } : {}),
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default async function BillDetailPage({
  params,
}: {
  params: RouteParams;
}) {
  const { congress, chamber, numberSlug } = await params;
  const parsed = parseBillPath([congress, chamber, numberSlug]);
  if (!parsed) notFound();

  const billIdKey = billIdentifierFor(
    parsed.chamberCode,
    parsed.number,
    parsed.congress,
  );
  if (!billIdKey) notFound();

  const [bill, actions, textVersions, cosponsorRows] = await Promise.all([
    prisma.bill.findUnique({ where: { billId: billIdKey } }),
    prisma.billAction.findMany({
      where: { bill: { billId: billIdKey } },
      orderBy: { actionDate: "asc" },
      select: { actionDate: true, chamber: true, text: true, actionType: true },
    }),
    prisma.billTextVersion.findMany({
      where: { bill: { billId: billIdKey } },
      orderBy: { versionDate: "asc" },
      select: {
        versionCode: true,
        versionType: true,
        versionDate: true,
        changeSummary: true,
        isSubstantive: true,
      },
    }),
    prisma.billCosponsor.findMany({
      where: { bill: { billId: billIdKey }, withdrawnAt: null },
      orderBy: [{ representative: { lastName: "asc" } }],
      select: {
        representative: {
          select: {
            bioguideId: true,
            slug: true,
            firstName: true,
            lastName: true,
            state: true,
            party: true,
          },
        },
      },
    }),
  ]);
  const cosponsors = cosponsorRows.map((c) => c.representative);

  if (!bill) notFound();

  // Canonicalize the URL: if the request came in via a non-canonical
  // shape (Congress.gov word form, uppercase chamber) or with a slug
  // that doesn't match the current title, 301 to the canonical.
  const canonicalHref = billHref({ billId: bill.billId, title: bill.title });
  const currentPath = `/bills/${congress}/${chamber}/${numberSlug}`;
  if (!parsed.canonical || currentPath !== canonicalHref) {
    permanentRedirect(canonicalHref);
  }

  // If this bill has no text and the cron hasn't tried recently, kick off
  // a background fetch so the user gets text on their next load instead
  // of waiting for the hourly backfill to reach their bill. No-op when
  // text is already present; atomic claim inside prevents N duplicate
  // fetches from N concurrent page loads.
  maybeFetchBillTextInBackground({
    id: bill.id,
    billId: bill.billId,
    title: bill.title,
    fullText: bill.fullText,
    textFetchAttemptedAt: bill.textFetchAttemptedAt,
  });

  // Resolve the sponsor to a Representative row so the card can show a
  // real photo + link to the rep's profile. Best-effort — we fall back
  // to a photoless card if the join fails (prior-Congress sponsor, data
  // drift, etc.). Keyed on lastName + state, then narrowed by firstName
  // + party. No `sponsorBioguideId` column yet; this is the v1 parser.
  const parsedSponsor = parseSponsorString(bill.sponsor);
  const sponsorRep = parsedSponsor
    ? await prisma.representative.findFirst({
        where: {
          lastName: parsedSponsor.lastName,
          state: parsedSponsor.state,
          party: { in: partyCodeToNames(parsedSponsor.party) },
          firstName: {
            startsWith: parsedSponsor.firstName,
            mode: "insensitive",
          },
        },
        select: {
          bioguideId: true,
          slug: true,
          firstName: true,
          lastName: true,
        },
      })
    : null;

  const typeInfo = getBillTypeInfo(bill.billType);
  const effectiveStatus = getEffectiveStatus(
    bill.billType,
    bill.currentStatus,
    actions,
    textVersions,
  );
  const journeySteps =
    actions.length > 0
      ? buildDynamicJourney(
          bill.billType,
          bill.currentStatus,
          actions,
          textVersions,
          effectiveStatus,
        )
      : getJourneySteps(bill.billType, effectiveStatus);
  const statusExplanation = getStatusExplanation(
    bill.billType,
    effectiveStatus,
  );
  const isEnacted = effectiveStatus.startsWith("enacted_");
  const isPassed =
    effectiveStatus.startsWith("passed_") ||
    effectiveStatus.startsWith("conference_") ||
    effectiveStatus.startsWith("pass_over_") ||
    effectiveStatus.startsWith("pass_back_");
  const isFailed =
    effectiveStatus.startsWith("fail_") ||
    effectiveStatus.startsWith("vetoed_") ||
    effectiveStatus.startsWith("prov_kill_");

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-6 py-8">
      {/* ── Title + plain-language lead + expandable about section ── */}
      <BillAboutSection
        title={bill.title}
        aiShortDescription={bill.aiShortDescription}
        aiKeyPoints={bill.aiKeyPoints}
        shortText={bill.shortText}
        introducedDate={dayjs(bill.introducedDate).format("MMM D, YYYY")}
        lastActionDate={
          bill.currentStatusDate && bill.currentStatus !== "introduced"
            ? dayjs(bill.currentStatusDate).format("MMM D, YYYY")
            : null
        }
        link={bill.link}
        readerHref={
          textVersions.length > 0
            ? billReadHref({ billId: bill.billId, title: bill.title })
            : null
        }
        typeLabel={typeInfo.label}
        typeDescription={typeInfo.description}
        statusHeadline={statusExplanation.headline}
        statusDetail={statusExplanation.detail}
        statusStyle={
          isEnacted
            ? "bg-enacted-soft text-enacted border-0"
            : isFailed
              ? "bg-failed-soft text-failed border-0"
              : isPassed
                ? "bg-passed-soft text-passed border-0"
                : "bg-muted text-muted-foreground border-0"
        }
        chamberStyle={
          bill.billType.startsWith("house")
            ? "border-house text-house"
            : "border-senate text-senate"
        }
        journeySteps={journeySteps}
        momentumTier={bill.momentumTier as MomentumTier | null}
        daysSinceLastAction={bill.daysSinceLastAction}
        deathReason={bill.deathReason as DeathReason | null}
      />

      {/* ── Who's behind this bill ── */}
      {parsedSponsor && (
        <section aria-label="Bill sponsor" className="space-y-2">
          <h2 className="text-muted-foreground text-xs font-semibold tracking-[0.15em] uppercase">
            Who introduced this
          </h2>
          <SponsorCard
            sponsor={bill.sponsor}
            rep={sponsorRep}
            cosponsors={cosponsors}
            cosponsorCount={bill.cosponsorCount}
            cosponsorPartySplit={bill.cosponsorPartySplit}
          />
        </section>
      )}

      {/* ── Engagement sections (reps, votes, discussion) ── */}
      <BillDetailInteractive billId={bill.id} />
    </div>
  );
}
