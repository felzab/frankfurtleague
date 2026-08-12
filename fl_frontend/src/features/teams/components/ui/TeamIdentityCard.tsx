/**
 * TEAMS · who the team is
 *
 * The record itself — name, school, the outward links and the club's own description. It names
 * the page's record, so its `h2` is the heading the shell's `h1` sits above (ADR-0046).
 */

import Link from "next/link";

import { Globe, MapPin } from "@gravity-ui/icons";

import { card } from "@/shared/components/ui/card";
import { ExpandableDescription } from "@/shared/components/ui/ExpandableDescription";
import { buildMapsSearchUrl, formatAddress } from "@/shared/utils/format";

import type { FLTeam } from "../../schemas";

export function TeamIdentityCard({ teamData }: { teamData: FLTeam }) {
  const formattedTeamAddress = formatAddress(teamData.address);
  // Deliberately formatAddress, not formatAddressFull: a team has no venue name to search by.
  const teamMapUrl = buildMapsSearchUrl(formattedTeamAddress);

  return (
    <div className={`${card()} flex w-full flex-col gap-y-1.5 p-4 sm:p-6`}>
      <h2 className="fluid-xl text-foreground font-extrabold tracking-tight">{teamData.name}</h2>

      {/* Offizieller Schulname. No emptiness guard: both schemas now require it. */}
      <p className="fluid-xs text-foreground-muted -mt-1.5 font-semibold">{teamData.full_name}</p>

      <div className="flex flex-col items-start gap-y-1 pt-2">
        <Link
          target="_blank"
          rel="noopener noreferrer"
          prefetch={false}
          href={teamData.website_url}
          className="fluid-xs text-brand flex flex-row items-center gap-x-2 font-bold hover:underline">
          <Globe
            aria-hidden="true"
            className="size-4 shrink-0"
          />
          <span>Schul-Website öffnen</span>
        </Link>

        <Link
          href={teamMapUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="fluid-xs text-brand flex flex-row items-start gap-x-2 font-bold hover:underline">
          <MapPin
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0"
          />
          <span>{formattedTeamAddress}</span>
        </Link>
      </div>

      {teamData.description && (
        <div className="mt-2 pt-2">
          <ExpandableDescription text={teamData.description} />
        </div>
      )}
    </div>
  );
}
