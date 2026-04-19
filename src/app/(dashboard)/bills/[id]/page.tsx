import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
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
import { ReadTextCTA } from "@/components/bills/read-text-cta";
import { BillDetailInteractive } from "./interactive";
import { parseSponsorString, partyCodeToNames } from "@/lib/sponsor";
import { maybeFetchBillTextInBackground } from "@/lib/on-demand-bill-text";
import type { MomentumTier, DeathReason } from "@/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const bill = await prisma.bill.findUnique({
    where: { id: parseInt(id) },
    select: { title: true, shortText: true },
  });

  const title = bill ? `${bill.title} — Govroll` : "Bill — Govroll";
  const description =
    bill?.shortText ??
    "Track this bill, see how your representatives voted, and share your opinion.";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      siteName: "Govroll",
      type: "article",
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
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const billId = parseInt(id);

  const [bill, actions, textVersions, cosponsorRows] = await Promise.all([
    prisma.bill.findUnique({ where: { id: billId } }),
    prisma.billAction.findMany({
      where: { billId },
      orderBy: { actionDate: "asc" },
      select: { actionDate: true, chamber: true, text: true, actionType: true },
    }),
    prisma.billTextVersion.findMany({
      where: { billId },
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
      where: { billId, withdrawnAt: null },
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

  // If this bill has no text and the cron hasn't tried recently, kick off
  // a background fetch so the user gets text on their next load instead
  // of waiting for the hourly backfill to reach their bill. No-op when
  // text is already present; atomic claim inside prevents N duplicate
  // fetches from N concurrent page loads.
  maybeFetchBillTextInBackground({
    id: bill.id,
    billId: bill.billId,
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
  // Count substantive versions after the introduced version. The CRS summary
  // shown on this page describes only the introduced text, so any substantive
  // amendments mean the summary may no longer reflect current bill content.
  const substantiveVersionCount = textVersions.filter(
    (v) => v.isSubstantive,
  ).length;
  const amendmentCount = Math.max(0, substantiveVersionCount - 1);
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
      {/* ── Title + expandable about section (title, journey, explainer, AI chat) ── */}
      <BillAboutSection
        title={bill.title}
        shortText={bill.shortText}
        introducedDate={dayjs(bill.introducedDate).format("MMM D, YYYY")}
        lastActionDate={
          bill.currentStatusDate && bill.currentStatus !== "introduced"
            ? dayjs(bill.currentStatusDate).format("MMM D, YYYY")
            : null
        }
        link={bill.link}
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
        amendmentCount={amendmentCount}
        momentumTier={bill.momentumTier as MomentumTier | null}
        daysSinceLastAction={bill.daysSinceLastAction}
        deathReason={bill.deathReason as DeathReason | null}
      />

      {/* ── Read the full text → /bills/[id]/read ── */}
      {textVersions.length > 0 && (
        <ReadTextCTA
          billId={bill.id}
          latestVersion={textVersions[textVersions.length - 1]}
        />
      )}

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
