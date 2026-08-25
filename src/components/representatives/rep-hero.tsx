import type { RepresentativeInfo } from "@/types";
import {
  partyLetter,
  chamberLabel,
  nextElection,
} from "@/lib/representative-utils";
import { RepPhoto } from "./rep-photo";

interface RepHeroProps {
  rep: RepresentativeInfo;
}

export function RepHero({ rep }: RepHeroProps) {
  const electionCountdown = nextElection(rep.termEnd, rep.chamber);

  return (
    <div className="border-rule border-l-sapphire bg-paper flex flex-col items-start gap-6 border border-l-4 p-6 sm:flex-row">
      {/* Photo — circular, ink ring, sand ground behind the fallback */}
      <div className="border-ink bg-sand relative h-28 w-28 flex-shrink-0 overflow-hidden rounded-full border-[1.5px]">
        <RepPhoto
          bioguideId={rep.bioguideId}
          firstName={rep.firstName}
          lastName={rep.lastName}
        />
      </div>

      {/* Info */}
      <div className="space-y-3">
        <div>
          <h1 className="wdth-110 text-ink text-3xl leading-tight font-bold sm:text-4xl">
            {rep.firstName} {rep.lastName}
          </h1>
          <p className="text-ink-muted mt-1 text-base">
            {chamberLabel(rep.chamber)}
            {rep.district ? `, ${rep.state}-${rep.district}` : `, ${rep.state}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Party is a letter in an identical ink-ring frame — never a colour */}
          <span
            className="party-node"
            title={rep.party.replace("Democratic", "Democrat")}
            aria-label={rep.party.replace("Democratic", "Democrat")}
          >
            {partyLetter(rep.party)}
          </span>
          <span className="text-ink-muted text-sm">
            Next election {electionCountdown}
          </span>
        </div>

        {rep.phone && (
          <a
            href={`tel:${rep.phone}`}
            className="text-ink-muted hover:text-ink inline-flex items-center gap-2 text-base transition-colors"
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
