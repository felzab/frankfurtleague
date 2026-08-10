/**
 * TEAMS · what the season amounted to
 *
 * The milestones a knockout run produces, derived from the fixtures the page already fetched
 * (`fl_frontend/src/features/teams/utils.ts :: computeSaisonVerlauf`). Nothing here is stored and
 * nothing is requested a second time.
 *
 * Invariants:
 * - A round finishing level yields no won/lost milestone: the bracket is the only reader that takes
 *   a winner from a shoot-out (ADR-0036).
 */

import { Chip } from "@heroui/react";

import { PHASE_LABELS } from "@/features/saisons/constants";
import { EmptyState } from "@/shared/components/ui/EmptyState";

import { computeSaisonVerlauf } from "../../utils";

import type { FLSpiel } from "@/features/spiele/schemas";

/**
 * Colour is the meaning here, so the three tints are the three kinds of milestone and not decoration:
 * something achieved, a plain statement of depth, and a run that ended. Each is the `-strong` accent
 * on its own `/15` fill — the pairing the accent tokens were measured at, and the fill-grade accent
 * alone does not carry text this size on a light surface.
 */
const MILESTONE_TINTS = {
  achieved: "bg-success/15 text-success-strong",
  neutral: "bg-info/15 text-info-strong",
  ended: "bg-danger/15 text-danger-strong",
} as const;

type Milestone = { label: string; tint: string };

export function TeamSaisonVerlauf({ teamSpiele, teamId }: { teamSpiele: FLSpiel[]; teamId: string }) {
  const verlauf = computeSaisonVerlauf({ spiele: teamSpiele, teamId });

  const milestones: Milestone[] = [];
  if (verlauf !== null) {
    const phase = PHASE_LABELS[verlauf.deepestPhase];

    milestones.push({ label: "Playoffs erreicht", tint: MILESTONE_TINTS.achieved });
    // Each milestone stands on its own, which is why the round is named twice: the row wraps, so the
    // depth and the outcome can end up on different lines with nothing between them to refer back to.
    milestones.push({ label: `Bis ins ${phase}`, tint: MILESTONE_TINTS.neutral });

    if (verlauf.outcome === "W") milestones.push({ label: `${phase} gewonnen`, tint: MILESTONE_TINTS.achieved });
    if (verlauf.outcome === "L") milestones.push({ label: `Im ${phase} ausgeschieden`, tint: MILESTONE_TINTS.ended });
  }

  return (
    <section className="flex flex-col gap-y-4">
      <h3 className="fluid-lg text-foreground font-extrabold tracking-tight">Saisonverlauf</h3>

      {milestones.length === 0 ? (
        <EmptyState
          title="Noch keine Meilensteine in dieser Saison."
          hint="Sobald dieses Team die Playoffs erreicht, steht hier, wie weit es gekommen ist."
        />
      ) : (
        <ul className="flex flex-row flex-wrap items-center gap-2">
          {milestones.map((milestone) => (
            <li key={milestone.label}>
              {/* `rounded-md` overrides HeroUI's `rounded-2xl` on `.chip`: one radius for every pill
                  in the app. A utility beats the component layer, so no `!` is needed. */}
              <Chip
                size="sm"
                className={`fluid-xxs rounded-md border-none px-2 py-1 font-bold ${milestone.tint}`}>
                {milestone.label}
              </Chip>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
