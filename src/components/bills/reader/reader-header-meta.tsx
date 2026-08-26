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
 * Kept free of client hooks itself — version-switch interactivity is
 * delegated up to `<BillReader>` via `onVersionChange`, which the
 * `<VersionPicker>` select calls.
 */
export function ReaderHeaderMeta({
  bill,
  version,
  availableVersions,
  sectionCount,
  readingMinutes,
  onVersionChange,
  pending,
  expandCollapseSlot,
}: {
  bill: ReaderBillMeta;
  version: ReaderVersionMeta;
  availableVersions: ReaderVersionListEntry[];
  sectionCount: number;
  readingMinutes: number;
  /** Switch to another text version (client-side fetch in <BillReader>). */
  onVersionChange?: (versionCode: string) => void;
  /** True while a version swap is in flight — disables the picker. */
  pending?: boolean;
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
      <div className="text-ink-muted bill-prose-meta mb-2 text-[11px] font-bold tracking-[0.18em] uppercase">
        <a href={bill.detailHref} className="hover:text-ink">
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
          className={`inline-flex items-center border px-2.5 py-0.5 text-xs font-bold tracking-[0.1em] uppercase ${statusTone.pillClass}`}
          title={statusInfo.detail}
        >
          {statusInfo.headline}
        </span>
        {sponsor ? (
          <span className="text-ink-muted bill-prose-meta">
            {sponsor.chamberPrefix ?? ""} {sponsor.firstName} {sponsor.lastName}{" "}
            <span className="opacity-70">
              ({sponsor.party}-{sponsor.state}
              {sponsor.district ? `-${sponsor.district}` : ""})
            </span>
          </span>
        ) : null}
        <span aria-hidden className="text-ink-muted opacity-40">
          ·
        </span>
        <span className="text-ink-muted bill-prose-meta tabular-nums">
          {sectionCountLabel} · {readingLabel}
        </span>
        {expandCollapseSlot ? (
          <>
            <span aria-hidden className="text-ink-muted opacity-40">
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
        onVersionChange={onVersionChange}
        pending={pending}
      />
    </header>
  );
}

/**
 * Roll Call status grammar (docs/design/roll-call.md, "UI patterns"):
 * status is stage, not verdict. Sapphire-deep fill + paper text =
 * terminal cleared; gold fill + ink text = pending action; outline =
 * in progress; faded hollow = dead. Bill failure is hollow, never red.
 */
function toneForStatus(status: string): { pillClass: string } {
  // Enacted — the bill's route reached its terminus.
  if (status.startsWith("enacted_")) {
    return {
      pillClass: "border-sapphire-deep bg-sapphire-deep text-paper",
    };
  }
  // Passed Congress / conference-done / concurrentres / simpleres —
  // all chambers cleared, awaiting president or already complete for
  // the measure's type. Gold = pending action ("awaiting signature").
  if (
    status === "passed_bill" ||
    status === "passed_concurrentres" ||
    status === "passed_simpleres" ||
    status.startsWith("conference_")
  ) {
    return {
      pillClass: "border-gold bg-gold text-ink",
    };
  }
  // Dead or blocked — the route ended here. Faded hollow, not red.
  if (
    status.startsWith("fail_") ||
    status.startsWith("prov_kill_") ||
    status.startsWith("vetoed_")
  ) {
    return {
      pillClass: "border-hollow bg-transparent text-ink-muted",
    };
  }
  // In progress (introduced, reported, passed one chamber, unknown) —
  // outline treatment; the label carries the distinction.
  return {
    pillClass: "border-ink bg-transparent text-ink",
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
