import Link from "next/link";

export default function ReaderNotFound() {
  return (
    <div className="mx-auto max-w-md px-6 py-24 text-center">
      <p className="text-civic-gold text-xs font-semibold tracking-[0.2em] uppercase">
        404 — Not found
      </p>
      <h1 className="text-foreground mt-3 text-2xl font-semibold">
        We couldn&apos;t find that bill
      </h1>
      <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
        It may have been removed, renumbered, or never existed at that ID.
      </p>
      <Link
        href="/bills"
        className="bg-primary text-primary-foreground hover:bg-primary/90 mt-6 inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-medium transition-colors"
      >
        Browse bills
      </Link>
    </div>
  );
}
