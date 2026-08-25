"use client";

import type { ReaderVersionListEntry, ReaderVersionMeta } from "./reader-types";

/**
 * Format a version date in UTC — version dates are stored as UTC
 * midnight, same convention as `BillAction.actionDate`, so local-
 * time rendering shifts them by a day for any US viewer after ~5 PM.
 * We always show the calendar date Congress.gov emits.
 */
function formatVersionDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date));
}

/**
 * Small inline line under the header that answers "which version of
 * this bill am I reading?". Renders as a plain dated label when there's
 * only one text-bearing version, and upgrades to a select when there
 * are multiple — bills with amendments, conference reports, and a
 * public law all live as separate `BillTextVersion` rows, and the
 * reader silently defaulting to "latest" hides that the reader might
 * want an earlier version.
 *
 * Version switching is delegated to the parent (<BillReader>) via
 * `onVersionChange`: it fetches the chosen version's sections and swaps
 * them in client-side, keeping the URL's `?v=` in sync. This is what
 * lets the reader route stay full-route ISR-cacheable (no server-side
 * `searchParams` read). `pending` disables the select mid-swap.
 */
export function VersionPicker({
  current,
  versions,
  detailHref,
  onVersionChange,
  pending = false,
}: {
  current: ReaderVersionMeta;
  versions: ReaderVersionListEntry[];
  detailHref: string;
  onVersionChange?: (versionCode: string) => void;
  pending?: boolean;
}) {
  const versionDateLabel = formatVersionDate(current.versionDate);
  const cleanType = cleanVersionType(current.versionType);

  // No other versions to switch to — show a static label.
  if (versions.length <= 1) {
    return (
      <div className="text-ink-muted mt-2 text-xs tabular-nums">
        Version: {cleanType} · {versionDateLabel}
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span className="text-ink-muted">Version:</span>
      <label className="sr-only" htmlFor="reader-version-picker">
        Bill text version
      </label>
      <select
        id="reader-version-picker"
        disabled={pending}
        value={current.versionCode}
        onChange={(event) => onVersionChange?.(event.target.value)}
        className="border-rule bg-paper hover:bg-muted/60 text-ink border px-1.5 py-0.5 text-xs tabular-nums transition-colors disabled:opacity-60"
      >
        {versions.map((v) => (
          <option key={v.versionCode} value={v.versionCode}>
            {cleanVersionType(v.versionType)} (
            {formatVersionDate(v.versionDate)})
          </option>
        ))}
      </select>
      <a
        href={detailHref}
        className="text-sapphire-deep underline-offset-2 hover:underline"
      >
        View all versions →
      </a>
    </div>
  );
}

/**
 * Congress.gov sometimes appends a parenthetical date to the version
 * type string ("Public Law (07/30/2024)"). We already render the date
 * separately, so strip that trailing parenthetical to avoid showing
 * the date twice.
 */
function cleanVersionType(raw: string): string {
  return raw.replace(/\s*\([^)]*\d[^)]*\)\s*$/, "").trim();
}
