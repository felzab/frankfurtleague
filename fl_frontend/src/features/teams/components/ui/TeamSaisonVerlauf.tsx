/**
 * TEAMS · what the season amounted to
 *
 * One chip per round the team has a fixture in, in the order a season plays them, derived from the
 * fixtures the page already fetched
 * (`fl_frontend/src/features/teams/utils.ts :: computeSaisonVerlauf`). Nothing here is stored and
 * nothing is requested a second time.
 *
 * Invariants:
 * - No chip says a team went out of the group phase: that state and an undrawn bracket look the same
 *   from here, and a placing may be acted on only once no result can change it (ADR-0035).
 * - A round that finished level claims no winner unless a later round fields the team, because the
 *   bracket is the only reader that takes one from a shoot-out (ADR-0036).
 */

import { Chip } from "@heroui/react";

import { PHASE_LABELS } from "@/features/saisons/constants";
import { EmptyState } from "@/shared/components/ui/EmptyState";

import { computeSaisonVerlauf } from "../../utils";

import type { FLSpiel } from "@/features/spiele/schemas";
import type { SaisonPhaseOutcome, SaisonPhaseVerlauf } from "../../utils";

/**
 * Colour is the meaning, so a tint per outcome and none for decoration: a round come through, a run
 * that ended, one still open, and one whose tie this page may not break. Each is the `-strong` accent
 * on its own `/15` fill — the pairing the accent tokens were measured at, and the fill-grade accent
 * alone does not carry text this size on a light surface. `level` takes the amber the timeline's draw
 * marker already uses, so a drawn round reads the same on both halves of the page.
 */
const OUTCOME_TINTS: Record<SaisonPhaseOutcome, string> = {
  won: "bg-success/15 text-success-strong",
  advanced: "bg-success/15 text-success-strong",
  out: "bg-danger/15 text-danger-strong",
  pending: "bg-info/15 text-info-strong",
  level: "bg-warning/15 text-warning-strong",
};

/**
 * Each chip is a whole sentence about one round, because the row wraps: two chips can land on
 * separate lines with nothing between them to refer back to, so none of them may lean on its
 * neighbour to say which round it means.
 */
const outcomeLabel = ({ phase, outcome }: SaisonPhaseVerlauf): string => {
  const round = PHASE_LABELS[phase];

  switch (outcome) {
    case "won":
      return `${round} gewonnen`;
    case "out":
      return `Im ${round} ausgeschieden`;
    case "advanced":
      return `${round} überstanden`;
    case "pending":
      return `Steht im ${round}`;
    case "level":
      return `${round} unentschieden`;
  }
};

export function TeamSaisonVerlauf({ teamSpiele, teamId }: { teamSpiele: FLSpiel[]; teamId: string }) {
  const verlauf = computeSaisonVerlauf({ spiele: teamSpiele, teamId });

  return (
    <section className="flex flex-col gap-y-4">
      <h2 className="fluid-lg text-foreground font-extrabold tracking-tight">Saisonverlauf</h2>

      {verlauf.length === 0 ? (
        <EmptyState
          title="Noch keine entschiedene Runde."
          hint="Sobald dieses Team eine Runde übersteht oder darin ausscheidet, steht sie hier."
        />
      ) : (
        <ul className="flex flex-row flex-wrap items-center gap-2">
          {verlauf.map((phaseVerlauf) => (
            <li key={phaseVerlauf.phase}>
              {/* `rounded-md` overrides HeroUI's `rounded-2xl` on `.chip`: one radius for every pill
                  in the app. A utility beats the component layer, so no `!` is needed. */}
              <Chip
                size="sm"
                className={`fluid-xxs rounded-md border-none px-2 py-1 font-bold ${OUTCOME_TINTS[phaseVerlauf.outcome]}`}>
                {outcomeLabel(phaseVerlauf)}
              </Chip>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
