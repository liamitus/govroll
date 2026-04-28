import { ExternalLink } from "lucide-react";

/**
 * Vertical "Sources" attribution block for the reader's outline rail
 * (desktop) and outline sheet (mobile). Shows where the bill text comes
 * from with deep links so readers can verify against the official source.
 *
 * Congress.gov is canonical (the upstream of truth); GovTrack is listed
 * as alternative context. "Source:" framing — not "View on" — to honor
 * Govroll's role as a presentation layer over official government data.
 */
export function SourceLinks({
  congressGovUrl,
  govtrackUrl,
}: {
  congressGovUrl: string | null;
  govtrackUrl: string | null;
}) {
  if (!congressGovUrl && !govtrackUrl) return null;
  return (
    <div className="text-xs">
      <p className="text-muted-foreground/70 mb-2 px-2 font-semibold tracking-[0.12em] uppercase">
        Sources
      </p>
      <ul className="space-y-1">
        {congressGovUrl ? (
          <li>
            <SourceLink href={congressGovUrl} label="Congress.gov" />
          </li>
        ) : null}
        {govtrackUrl ? (
          <li>
            <SourceLink href={govtrackUrl} label="GovTrack" />
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function SourceLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-muted-foreground hover:text-foreground hover:bg-muted/60 inline-flex w-full items-center gap-1.5 rounded-md px-2 py-1 transition-colors"
    >
      <span>{label}</span>
      <ExternalLink className="h-3 w-3 opacity-70" aria-hidden="true" />
      <span className="sr-only">(opens in new tab)</span>
    </a>
  );
}
