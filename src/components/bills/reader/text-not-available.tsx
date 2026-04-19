import Link from "next/link";

/**
 * Friendly state for when a bill has no usable text yet (and therefore
 * nothing to render in the reader). The page-level RSC is responsible
 * for kicking off `maybeFetchBillTextInBackground` so a refresh in a
 * minute or two will likely succeed; here we just explain and offer
 * the user a path back to the engagement page.
 */
export function TextNotAvailable({
  bill,
}: {
  bill: { id: number; title: string; link?: string | null };
}) {
  return (
    <div className="bg-civic-cream/40 dark:bg-card min-h-screen">
      <div className="mx-auto max-w-2xl px-6 py-24 text-center">
        <p className="text-civic-gold text-xs font-semibold tracking-[0.2em] uppercase">
          Text not yet available
        </p>
        <h1 className="text-foreground mt-3 text-2xl font-semibold sm:text-3xl">
          {bill.title}
        </h1>
        <p className="text-muted-foreground mx-auto mt-6 max-w-lg text-sm leading-relaxed">
          We&apos;re fetching the official bill text from Congress.gov in the
          background. Try again in a few minutes — or read the bill on
          Congress.gov directly while we catch up.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href={`/bills/${bill.id}`}
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-medium transition-colors"
          >
            Back to bill page
          </Link>
          {bill.link ? (
            <a
              href={bill.link}
              target="_blank"
              rel="noopener noreferrer"
              className="border-border hover:bg-muted inline-flex h-10 items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors"
            >
              View on Congress.gov ↗
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
