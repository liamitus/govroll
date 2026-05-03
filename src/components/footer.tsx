import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-navy/10 bg-civic-cream/50 border-t">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <nav className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
            <Link
              href="/about"
              className="hover:text-foreground transition-colors"
            >
              About
            </Link>
            <Link
              href="/privacy"
              className="hover:text-foreground transition-colors"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="hover:text-foreground transition-colors"
            >
              Terms
            </Link>
            <Link
              href="/contact"
              className="hover:text-foreground transition-colors"
            >
              Contact
            </Link>
            <Link
              href="/support"
              className="hover:text-foreground transition-colors"
            >
              Support Govroll
            </Link>
          </nav>

          <p className="text-muted-foreground/70 text-sm">
            {`© ${new Date().getFullYear()} Govroll · Built by `}
            <a
              href="https://liamhowell.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              Liam Howell
            </a>
          </p>
        </div>

        <div className="text-muted-foreground/60 mt-4 space-y-1.5 text-center text-xs leading-relaxed">
          <p>
            Independent, non-partisan, and reader-supported. Govroll is not
            affiliated with or endorsed by the U.S. government.
          </p>
          <p>
            Legislative data from{" "}
            <a
              href="https://congress.gov"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-muted-foreground underline underline-offset-2"
            >
              congress.gov
            </a>
            {" · "}
            Representative data from{" "}
            <a
              href="https://github.com/unitedstates/congress-legislators"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-muted-foreground underline underline-offset-2"
            >
              unitedstates/congress-legislators
            </a>
            {" · "}
            Geocoding via{" "}
            <a
              href="https://geocoding.geo.census.gov/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-muted-foreground underline underline-offset-2"
            >
              U.S. Census Bureau
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
