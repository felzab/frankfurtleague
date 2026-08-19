import { Chip } from "@heroui/react";

import { PHASE_LABELS, PHASE_TINTS } from "@/features/saisons/constants";
import { PILL_RADIUS } from "@/shared/components/ui/badges";
import { EmptyState } from "@/shared/components/ui/EmptyState";

import { computeSaisonVerlauf } from "../../utils";

import type { FLSpiel } from "@/features/spiele/schemas";
import type { SaisonPhaseOutcome, SaisonPhaseVerlauf } from "../../utils";

/**
 * A tint per outcome, none for decoration. `level` takes the timeline's draw amber.
 *
 * **`pending` is not here**: a round nobody has played names a ROUND, not an outcome, so it takes
 * `PHASE_TINTS` instead — see `chipTint`.
 */
const OUTCOME_TINTS: Record<Exclude<SaisonPhaseOutcome, "pending">, string> = {
  won: "bg-success/15 text-success-strong",
  advanced: "bg-success/15 text-success-strong",
  out: "bg-danger/15 text-danger-strong",
  level: "bg-warning/15 text-warning-strong",
  // The timeline's `?` dot pairing, so grey means "nothing is claimed" on both halves of the page.
  unknown: "bg-muted text-foreground-muted",
};

/**
 * An outcome chip keeps its semantic colour; a standing chip takes its round's. "Steht im Halbfinale"
 * reports nothing about how anything went, so a feedback accent would colour a result the season
 * does not have.
 */
const chipTint = ({ phase, outcome }: SaisonPhaseVerlauf): string => (outcome === "pending" ? PHASE_TINTS[phase] : OUTCOME_TINTS[outcome]);

/**
 * Each chip is a whole sentence, because the row wraps and one may land alone on a line.
 *
 * `im` fits the neuter knockout round names; the feminine `Gruppenphase` would read "Im
 * Gruppenphase" and never arrives here.
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
    // The round's name and no verb: this case has nothing to say about how the round went.
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
        // chip. It promises nothing about what comes next.
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
