/**
 * Shared types for the bill reader (`/bills/[id]/read`).
 *
 * `ReaderSection` is the merged shape passed from the RSC page down
 * into the (eventually) client `<BillReader>` shell — it bundles the
 * parsed section content, the canonical slug, and the AI caption (if
 * any) so the rendering tree never has to know about the parser or
 * the captions table independently.
 */

import type { BillSection } from "@/lib/bill-sections";

export interface ReaderSection extends BillSection {
  /** Stable URL-safe slug, computed once via `sectionSlugsForBill`. */
  slug: string;
  /** Visual nesting depth (1 = top-level Section/Title/Division, deeper
   *  = subsections). Used to map to h2/h3/h4 in the renderer. */
  depth: number;
  /** AI-generated one-sentence caption, or null if not yet generated
   *  (or filtered out by validation in section-caption.ts). */
  caption: string | null;
}

export interface ReaderBillMeta {
  id: number;
  billId: string;
  /** Verbatim official title from Congress.gov. Used for slug/URL
   *  generation and as the citable text in `aria-label`. For visible
   *  display, prefer `headline`. */
  title: string;
  /** Display headline derived from the full title-resolution chain
   *  (popularTitle → shortTitle → displayTitle → summary extract → AI
   *  → rule synth → amendment synth → title). Always renderable;
   *  for short clean titles it's identical to `title`. */
  headline: string;
  billType: string;
  /** GovTrack URL from the legacy `Bill.link` column. Null when unset
   *  on older rows; the reader's "Sources" block hides the link in
   *  that case. */
  govtrackUrl: string | null;
}

export interface ReaderVersionMeta {
  id: number;
  versionCode: string;
  versionType: string;
  versionDate: Date;
  isSubstantive: boolean;
}
