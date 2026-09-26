"use client";

import { TeamPopoverMenu } from "@/features/teams/components/ui/TeamPopoverMenu";
import { PLACEHOLDER } from "@/shared/utils/format";

import { formatQuelle } from "../../utils";
import { SLOT_LABEL_WRAP_CLASSES, TEAM_NAME_TRACK_CLASSES, TEAM_NAME_WRAP_CLASSES } from "./teamName";

import type { FLSpielQuelle, FLSpielTeamFieldJoined } from "../../schemas";

/**
 * What the three cards share here is the branch whose copies would each be a crash rather than a
 * cosmetic difference — dereferencing a `null` side — plus the DQ badge. An unresolved side mounts
 * no `TeamPopoverMenu`: no team page to link to.
 */
export function SpielTeamSlot({
  team,
  quelle,
  saisonId,
  text,
  className,
}: {
  team: FLSpielTeamFieldJoined | null;
  quelle: FLSpielQuelle | null;
  /**
   * The fixture's own `saison_id`, REQUIRED rather than optional: every card holds one, and a card
   * leaving it out sends a past season's club to „nicht gefunden“.
   */
  saisonId: string;
  /** The full name on the two wide cards, the shorthand on the bracket. */
  text: string;
  /** Size, weight and alignment only; the wrap, interactive and muted styling are this component's. */
  className: string;
}) {
  // `className` on the track too, where `lh` resolves against the name's own size, and still on the
  // name, whose alignment the popover trigger's `text-left` would otherwise decide.
  if (team === null) {
    return (
      <span className={`${className} ${TEAM_NAME_TRACK_CLASSES}`}>
        <span className={`${className} ${SLOT_LABEL_WRAP_CLASSES} text-foreground-muted italic`}>
          {formatQuelle(quelle) ?? PLACEHOLDER.slot}
        </span>
      </span>
    );
  }

  return (
    <span className={`${className} ${TEAM_NAME_TRACK_CLASSES}`}>
      <TeamPopoverMenu
        teamName={team.name}
        teamId={team.team_id}
        teamAustritt={team.austritt_type}
        saisonId={saisonId}>
        <strong className={`${className} ${TEAM_NAME_WRAP_CLASSES} transition-colors duration-(--motion-base) hover:text-brand`}>{text}</strong>
      </TeamPopoverMenu>
    </span>
  );
}
