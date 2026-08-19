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
 *   from here, so the group's chip is either come-through or muted with no outcome word.
 * - A round that finished level claims no winner unless a later round fields the team, because the
 *   bracket is the only reader that takes one from a shoot-out.
 */

import { Chip } from "@heroui/react";

import { PHASE_LABELS, PHASE_TINTS } from "@/features/saisons/constants";
import { PILL_RADIUS } from "@/shared/components/ui/badges";
import { EmptyState } from "@/shared/components/ui/EmptyState";

import { computeSaisonVerlauf } from "../../utils";

import type { FLSpiel } from "@/features/spiele/schemas";
import type { SaisonPhaseOutcome, SaisonPhaseVerlauf } from "../../utils";

/**
 * Colour is the meaning, so a tint per outcome and none for decoration: a round come through, a run
 * that ended, and one whose tie this page may not break. Each is the `-strong` accent on its own `/15`
 * fill — the pairing the accent tokens were measured at, and the fill-grade accent alone does not carry
 * text this size on a light surface. `level` takes the amber the timeline's draw marker already uses,
 * so a drawn round reads the same on both halves of the page.
 *
 * **`pending` is not here**: a round nobody has played yet is a statement about WHICH round, so it takes
 * that round's own colour from `PHASE_TINTS` — see `chipTint` below.
 */
const OUTCOME_TINTS: Record<Exclude<SaisonPhaseOutcome, "pending">, string> = {
  won: "bg-success/15 text-success-strong",
  advanced: "bg-success/15 text-success-strong",
  out: "bg-danger/15 text-danger-strong",
  level: "bg-warning/15 text-warning-strong",
  // The pairing the timeline's `?` dot uses for a fixture it cannot read, so grey means "nothing is
  // claimed" on both halves of this page rather than in a treatment invented here.
  unknown: "bg-muted text-foreground-muted",
};

/**
 * An outcome chip keeps its semantic colour and a standing chip takes its round's.
 *
 * **The split is what the chip is about.** "Im Halbfinale ausgeschieden" reports how the round went, and
 * red is that news; "Steht im Halbfinale" reports nothing about how anything went, so a feedback accent
 * on it would colour a result the season does not have — the round is the only thing it names, and
 * `PHASE_TINTS` is what names a round everywhere else in the app (`SaisonPhaseChip`).
 *
 * Every phase has an entry there, including `gruppenphase`, which `computeSaisonVerlauf` never resolves
 * to `pending`: the map is keyed by the type rather than by that reachability, so no round can arrive
 * here without a colour somebody chose.
 */
const chipTint = ({ phase, outcome }: SaisonPhaseVerlauf): string => (outcome === "pending" ? PHASE_TINTS[phase] : OUTCOME_TINTS[outcome]);

/**
 * Each chip is a whole sentence about one round, because the row wraps: two chips can land on
 * separate lines with nothing between them to refer back to, so none of them may lean on its
 * neighbour to say which round it means.
 *
 * The `im` in the `out` and `pending` cases fits a neuter round name, which every knockout round in
 * `PHASE_LABELS` has. The feminine `Gruppenphase` would read "Im Gruppenphase" and never arrives
 * here, because `computeSaisonVerlauf` resolves that phase to `advanced` or `unknown` alone.
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
    // The round's name and no verb: every other case ends in a word about how the round went, and
    // this one has none to give.
    case "unknown":
      return round;
  }
};

export function TeamSaisonVerlauf({ teamSpiele, teamId }: { teamSpiele: FLSpiel[]; teamId: string }) {
  const verlauf = computeSaisonVerlauf({ spiele: teamSpiele, teamId });

  return (
    <section className="flex flex-col gap-y-4">
      <h2 className="fluid-lg text-foreground font-extrabold tracking-tight">Saisonverlauf</h2>

      {verlauf.length === 0 ? (
        // Reached only where the team has no fixture at all, since the group phase always yields a
        // chip. It promises nothing: a disqualified team renders its note higher up the page, and a
        // past season reached by `?saison_id=` has no future left.
        <EmptyState
          title="Für dieses Team ist keine Runde vermerkt."
          hint="Diese Übersicht zeigt jede Runde, in der dieses Team ein Spiel hat."
        />
      ) : (
        <ul className="flex flex-row flex-wrap items-center gap-2">
          {verlauf.map((phaseVerlauf) => (
            <li key={phaseVerlauf.phase}>
              <Chip
                size="sm"
                className={`${PILL_RADIUS} fluid-xxs border-none px-2 py-1 font-bold ${chipTint(phaseVerlauf)}`}>
                {outcomeLabel(phaseVerlauf)}
              </Chip>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
