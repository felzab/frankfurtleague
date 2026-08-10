"use client";

import { TeamPopoverMenu } from "@/features/teams/components/ui/TeamPopoverMenu";
import { PLACEHOLDER } from "@/shared/utils/format";

import { formatQuelle } from "../../utils";

import type { FLSpielQuelle, FLSpielTeamFieldJoined } from "../../schemas";

/**
 * One side of a fixture, as a match card renders it.
 *
 * A resolved side is its own text behind a `TeamPopoverMenu`. A side whose occupant the group phase
 * has not produced yet renders its derived source label — "Sieger 25.", "1. der Gruppe A" — as plain text and mounts no
 * popover at all: there is no team page and no squad to link to (ADR-0034).
 *
 * **This is the one place the three cards get their DQ badge**, because it is the one place they mount
 * the popover. The side arrives carrying its season's `disqualifikation`, joined onto the match by the
 * backend rather than fetched here (ADR-0021, rule 4), so the badge costs this component no request.
 *
 * **The three `SpielCard` variants stay separate** (ADR-0005) and pass their own `text` and layout
 * classes. What is shared here is the branch whose copies would each be a crash rather than a
 * cosmetic difference if one drifted — dereferencing a side that is `null`.
 * `fl_frontend/src/features/spiele/components/modals/SpielDetailsModal.tsx :: TeamNameLine` makes the
 * same decision a fourth time and deliberately does not use this component: it renders a plain `Link`
 * rather than a popover, for the reason recorded there.
 *
 * The interactive classes are added here rather than by the caller, because they belong to the
 * resolved branch alone: `hover:text-brand` on a label nothing opens is a promise the card cannot keep.
 */
export function SpielTeamSlot({
  team,
  quelle,
  text,
  className,
}: {
  team: FLSpielTeamFieldJoined | null;
  quelle: FLSpielQuelle | null;
  /** What a RESOLVED side shows — the full name on the two wide cards, the shorthand on the bracket. */
  text: string;
  /** Layout only: size, alignment, truncation. Interactive and muted styling is this component's. */
  className: string;
}) {
  if (team === null) {
    return <span className={`${className} text-foreground-muted italic`}>{formatQuelle(quelle) ?? PLACEHOLDER.slot}</span>;
  }

  return (
    <TeamPopoverMenu
      teamName={team.name}
      teamId={team.team_id}
      teamIsDisqualified={team.disqualifikation !== null}>
      <strong className={`${className} hover:text-brand transition-colors duration-200`}>{text}</strong>
    </TeamPopoverMenu>
  );
}
