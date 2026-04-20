import Link from "next/link";
import dayjs from "dayjs";
import { billReadHref, type BillForUrl } from "@/lib/bills/url";

/**
 * Prominent CTA card linking from the bill detail page to the
 * reader. Renders only when at least one text version exists in our
 * DB — otherwise we don't make a promise we might not deliver on.
 * The reader page itself handles the case where the row exists but
 * has no `fullText` yet.
 */
export function ReadTextCTA({
  bill,
  latestVersion,
}: {
  bill: BillForUrl;
  latestVersion: {
    versionType: string;
    versionDate: Date;
    changeSummary: string | null;
  };
}) {
  return (
    <Link
      href={billReadHref(bill)}
      className="border-civic-gold/40 bg-civic-cream/40 hover:bg-civic-cream/60 dark:bg-card dark:hover:bg-accent/30 group focus-visible:ring-civic-gold/40 focus-visible:border-civic-gold block rounded-xl border p-5 transition-colors focus:outline-none focus-visible:ring-2"
    >
      <div className="flex items-start gap-4">
        <div className="bg-civic-gold/10 text-civic-gold flex h-10 w-10 flex-none items-center justify-center rounded-lg">
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
            />
          </svg>
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="text-foreground text-base font-semibold">
            Read the full text
          </h2>
          <p className="text-muted-foreground mt-1 text-sm leading-snug">
            {latestVersion.changeSummary ??
              `Latest version: ${latestVersion.versionType} (${dayjs(
                latestVersion.versionDate,
              ).format("MMM D, YYYY")})`}
          </p>
        </div>

        <div
          className="text-muted-foreground group-hover:text-civic-gold flex-none self-center transition-colors"
          aria-hidden
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M14 5l7 7m0 0l-7 7m7-7H3"
            />
          </svg>
        </div>
      </div>
    </Link>
  );
}
