/**
 * Skeleton fallback while the reader page's RSC is fetching + parsing.
 * Matches the layout shape so there's no jarring layout shift on swap.
 */
export default function ReaderLoading() {
  return (
    <div className="bg-civic-cream/40 dark:bg-background min-h-screen">
      <div className="border-civic-gold/20 mx-auto h-12 max-w-[72ch] border-b px-6" />
      <div className="mx-auto max-w-[72ch] animate-pulse space-y-4 px-6 pt-10">
        <div className="bg-muted h-8 w-3/4 rounded" />
        <div className="bg-muted/70 h-4 w-1/3 rounded" />
        <div className="space-y-3 pt-8">
          <div className="bg-muted/60 h-5 w-2/3 rounded" />
          <div className="bg-muted/40 h-3 w-full rounded" />
          <div className="bg-muted/40 h-3 w-11/12 rounded" />
          <div className="bg-muted/40 h-3 w-10/12 rounded" />
        </div>
        <div className="space-y-3 pt-6">
          <div className="bg-muted/60 h-5 w-1/2 rounded" />
          <div className="bg-muted/40 h-3 w-full rounded" />
          <div className="bg-muted/40 h-3 w-9/12 rounded" />
        </div>
      </div>
    </div>
  );
}
