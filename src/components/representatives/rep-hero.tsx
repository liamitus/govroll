import { Badge } from "@/components/ui/badge";
import type { RepresentativeInfo } from "@/types";
import {
  partyColor,
  chamberLabel,
  nextElection,
} from "@/lib/representative-utils";
import { RepPhoto } from "./rep-photo";

interface RepHeroProps {
  rep: RepresentativeInfo;
}

export function RepHero({ rep }: RepHeroProps) {
  const colors = partyColor(rep.party);
  const electionCountdown = nextElection(rep.termEnd, rep.chamber);

  return (
    <div className="flex flex-col items-start gap-6 sm:flex-row">
      {/* Photo */}
      <div className="bg-muted relative h-40 w-32 flex-shrink-0 overflow-hidden rounded-lg shadow-sm">
        <RepPhoto
          bioguideId={rep.bioguideId}
          firstName={rep.firstName}
          lastName={rep.lastName}
        />
      </div>

      {/* Info */}
      <div className="space-y-3">
        <div>
          <h1 className="font-gelasio text-navy text-3xl leading-tight font-bold sm:text-4xl">
            {rep.firstName} {rep.lastName}
          </h1>
          <p className="text-muted-foreground mt-1 text-base">
            {chamberLabel(rep.chamber)}
            {rep.district ? `, ${rep.state}-${rep.district}` : `, ${rep.state}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge className={colors.badge}>
            {rep.party.replace("Democratic", "Democrat")}
          </Badge>
          <span className="text-muted-foreground text-sm">
            Next election {electionCountdown}
          </span>
        </div>

        {rep.phone && (
          <a
            href={`tel:${rep.phone}`}
            className="text-muted-foreground hover:text-navy inline-flex items-center gap-2 text-base transition-colors"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            {rep.phone}
          </a>
        )}
      </div>
    </div>
  );
}
