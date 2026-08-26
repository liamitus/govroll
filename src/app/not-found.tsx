import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-20">
      {/* Dashed hollow frame — the register's treatment for absence. */}
      <div className="border-hollow bg-paper mx-auto max-w-md space-y-6 border-[1.5px] border-dashed px-8 py-12 text-center">
        <p className="text-ink-muted text-[11px] font-bold tracking-[0.18em] uppercase">
          Page not found
        </p>
        <h1 className="text-ink text-5xl font-bold tracking-tight">404</h1>
        <p className="text-ink-muted text-base">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="flex justify-center gap-4 pt-4">
          <Link
            href="/"
            className="bg-sapphire-deep hover:bg-ink text-paper inline-flex items-center px-4 py-2 text-base font-medium transition-colors"
          >
            Go home
          </Link>
          <Link
            href="/bills"
            className="border-rule text-ink hover:bg-ink/5 inline-flex items-center border px-4 py-2 text-base font-medium transition-colors"
          >
            Browse bills
          </Link>
        </div>
      </div>
    </div>
  );
}
