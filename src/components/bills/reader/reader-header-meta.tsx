import { getBillTypeInfo, getStatusExplanation } from "@/lib/bill-helpers";
import { parseSponsorString } from "@/lib/sponsor";

import type {
  ReaderBillMeta,
  ReaderVersionListEntry,
  ReaderVersionMeta,
} from "./reader-types";
import { VersionPicker } from "./version-picker";

/**
 * Top-of-reader meta block: bill number + status pill + sponsor + the
 * "which version of the bill am I reading" line. This is the reader's
 * orientation layer — a new visitor should be able to tell at a glance
 * what they're looking at, whether it's law yet, and who wrote it,
 * without clicking away to the detail page.
 *
 * Separated from `<BillReader>` so it can stay a pure server component
 * (no client hooks), while `<VersionPicker>` is the one piece of it
 * that needs client interactivity.
 */
export function ReaderHeaderMeta({
  bill,
  version,
  availableVersions,
  sectionCount,
  readingMinutes,
  expandCollapseSlot,
}: {
  bill: ReaderBillMeta;
  version: ReaderVersionMeta;
  availableVersions: ReaderVersionListEntry[];
  sectionCount: number;
  readingMinutes: number;
  /**
   * The `<ExpandCollapseAll>` toggle. Rendered by the parent because
   * it's a client component and its availability depends on group
   * count; we just place it in the meta row.
   */
  expandCollapseSlot: React.ReactNode;
}) {
  const statusInfo = getStatusExplanation(bill.billType, bill.currentStatus);
  const statusTone = toneForStatus(bill.currentStatus);
  const sponsor = parseSponsorString(bill.sponsor);

  const sectionCountLabel = `${sectionCount} section${sectionCount === 1 ? "" : "s"}`;
  const readingLabel = `${readingMinutes} min read`;

  return (
    <header className="mb-10">
      <div className="text-muted-foreground bill-prose-meta mb-2 text-xs font-medium tracking-wide uppercase">
        <a href={bill.detailHref} className="hover:text-foreground">
          {bill.displayNumber}
        </a>
        <span aria-hidden className="mx-1.5 opacity-40">
          ·
        </span>
        <span>{bill.congressLabel} Congress</span>
      </div>

      <h1 className="bill-prose-title">{bill.headline}</h1>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wide uppercase ${statusTone.pillClass}`}
          title={statusInfo.detail}
        >
          {statusInfo.headline}
        </span>
        {sponsor ? (
          <span className="text-muted-foreground bill-prose-meta">
            {sponsor.chamberPrefix ?? ""} {sponsor.firstName} {sponsor.lastName}{" "}
            <span className="opacity-70">
              ({sponsor.party}-{sponsor.state}
              {sponsor.district ? `-${sponsor.district}` : ""})
            </span>
          </span>
        ) : null}
        <span aria-hidden className="text-muted-foreground opacity-40">
          ·
        </span>
        <span className="text-muted-foreground bill-prose-meta">
          {sectionCountLabel} · {readingLabel}
        </span>
        {expandCollapseSlot ? (
          <>
            <span aria-hidden className="text-muted-foreground opacity-40">
              ·
            </span>
            {expandCollapseSlot}
          </>
        ) : null}
      </div>

      <VersionPicker
        detailHref={bill.detailHref}
        current={version}
        versions={availableVersions}
      />
    </header>
  );
}

function toneForStatus(status: string): { pillClass: string } {
  // Enacted — the bill is law. Strong positive tone.
  if (status.startsWith("enacted_")) {
    return {
      pillClass:
        "border-emerald-300/70 bg-emerald-50 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-100",
    };
  }
  // Passed Congress / conference-done / concurrentres / simpleres —
  // all chambers cleared, awaiting president or already complete for
  // the measure's type.
  if (
    status === "passed_bill" ||
    status === "passed_concurrentres" ||
    status === "passed_simpleres" ||
    status.startsWith("conference_")
  ) {
    return {
      pillClass:
        "border-violet-300/70 bg-violet-50 text-violet-900 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-100",
    };
  }
  // Active but not done — reported or passed one chamber.
  if (
    status === "reported" ||
    status === "pass_over_house" ||
    status === "pass_over_senate" ||
    status === "pass_back_house" ||
    status === "pass_back_senate"
  ) {
    return {
      pillClass:
        "border-sky-300/70 bg-sky-50 text-sky-900 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-100",
    };
  }
  // Dead or blocked.
  if (
    status.startsWith("fail_") ||
    status.startsWith("prov_kill_") ||
    status.startsWith("vetoed_")
  ) {
    return {
      pillClass:
        "border-rose-300/70 bg-rose-50 text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-100",
    };
  }
  // Introduced or unknown — neutral.
  return {
    pillClass:
      "border-civic-gold/40 bg-civic-gold/10 text-navy dark:text-civic-gold",
  };
}

/**
 * Compose the short display number used in the top meta line.
 * Mirrors Congress.gov conventions: "S. 3706", "H.R. 1234", "H.J. Res. 55".
 */
export function displayNumberFor(billType: string, number: number): string {
  const info = getBillTypeInfo(billType);
  return `${info.shortLabel} ${number}`;
}

/**
 * "118th", "119th", "3rd" — ordinal suffix for the Congress number.
 */
export function congressOrdinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const rem10 = n % 10;
  if (rem10 === 1) return `${n}st`;
  if (rem10 === 2) return `${n}nd`;
  if (rem10 === 3) return `${n}rd`;
  return `${n}th`;
}
