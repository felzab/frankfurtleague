"use client";

import { TeamPopoverMenu } from "@/features/teams/components/ui/TeamPopoverMenu";
import { PLACEHOLDER } from "@/shared/utils/format";

import { formatQuelle } from "../../utils";

import type { FLSpielQuelle, FLSpielTeamFieldJoined } from "../../schemas";

/**
 * What the three cards share here is the branch whose copies would each be a crash rather than a
 * cosmetic difference — dereferencing a `null` side — plus the DQ badge. An unresolved side mounts
 * no `TeamPopoverMenu`: no team page to link to.
 */
export function SpielTeamSlot({
  team,
  quelle,
  text,
  className,
}: {
  team: FLSpielTeamFieldJoined | null;
  quelle: FLSpielQuelle | null;
  /** The full name on the two wide cards, the shorthand on the bracket. */
  text: string;
  /** Layout only; interactive and muted styling is this component's. */
  className: string;
}) {
  if (team === null) {
    return <span className={`${className} text-foreground-muted italic`}>{formatQuelle(quelle) ?? PLACEHOLDER.slot}</span>;
  }

  return (
    <TeamPopoverMenu
      teamName={team.name}
      teamId={team.team_id}
      teamAustritt={team.austritt_type}>
      <strong className={`${className} hover:text-brand transition-colors duration-200`}>{text}</strong>
    </TeamPopoverMenu>
  );
}
