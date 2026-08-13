/**
 * SAISONS · search copy, the season id's shape, and the phases' German names and colours
 *
 * Its own module, not an export from a view: those files are `"use client"`, and every export of a
 * client module becomes a client reference on the server side.
 *
 * The page's name and its explanation are NOT here — they are the navigation structure's, which the
 * shell's bar renders, so the title an admin reads is the nav item they clicked (ADR-0046).
 */

import type { FLSaisonPhase } from "./schemas";

export const SAISONS_CRUD_COPY = {
  searchLabel: "Saison suchen",
  searchPlaceholder: "Suchen nach Saison-ID oder Zeitraum...",
} as const;

/**
 * The five phases in the order a season runs them: the order the admin list sections them in, the order
 * the picker offers them, and the order `PHASE_RANK` in `fl_frontend/src/features/spiele/utils.ts`
 * derives its comparison from.
 *
 * **The schema owns the SET and this owns the SEQUENCE** — the same split `POSITION_OPTIONS` makes for
 * the player positions. It is the competition's own order rather than a presentation choice: a season
 * plays its group phase and then each knockout round in turn, which is why the bracket rules can rank
 * phases against it (ADR-0052).
 */
export const SAISON_PHASE_OPTIONS: readonly FLSaisonPhase[] = ["gruppenphase", "achtelfinale", "viertelfinale", "halbfinale", "finale"];

/**
 * What each `saison_phase` is called on screen — one German spelling of the five, for every surface.
 *
 * **In this slice because `FLSaisonPhaseSchema` is**, and a label belongs beside the set it labels: both
 * `spiele` and `spieltage` already import the phase type from here, so reading its names from the same
 * place adds no edge to the import graph. **A `.ts` module rather than an export from the chip that
 * renders them**, and that is load-bearing rather than tidiness: the node test runner cannot load a
 * `.tsx` module, so nothing importing one could be unit-tested.
 */
export const PHASE_LABELS: Record<FLSaisonPhase, string> = {
  gruppenphase: "Gruppenphase",
  achtelfinale: "Achtelfinale",
  viertelfinale: "Viertelfinale",
  halbfinale: "Halbfinale",
  finale: "Finale",
};

/**
 * What each `saison_phase` is coloured on screen — one fill-and-ink pair of the five, beside the names
 * for the reason the names are here: a phase's colour is a fact about the phase, and a second copy of
 * these ten class names is a second thing to keep in step. `SaisonPhaseChip` reads it, and so does
 * `TeamSaisonVerlauf` for a round the team is still standing in.
 *
 * **The fill is the ink at `/10`, and the grade is measured rather than picked.** As small bold text on
 * its own fill in the light theme, the tightest phase is `finale` at 4.63:1 on `--bg-surface` and 5.03:1
 * on `--bg-base`, the two surfaces these chips sit on; the dark theme's lightest margin is 5.30:1. At
 * `/15` the same light-theme pair falls to 4.22:1 on `--bg-surface`, below the 4.5:1 floor.
 */
export const PHASE_TINTS: Record<FLSaisonPhase, string> = {
  gruppenphase: "bg-phase-gruppenphase/10 text-phase-gruppenphase",
  achtelfinale: "bg-phase-achtelfinale/10 text-phase-achtelfinale",
  viertelfinale: "bg-phase-viertelfinale/10 text-phase-viertelfinale",
  halbfinale: "bg-phase-halbfinale/10 text-phase-halbfinale",
  finale: "bg-phase-finale/10 text-phase-finale",
};

/**
 * Exactly four characters, and the create form carries the bound so the browser refuses a fifth
 * keystroke.
 *
 * `saisons._id` is the string every `saison_id` in the database references, and both `FLSpiel` and
 * `FLSpieltag` require exactly this length of whatever they point at — so a longer id validates as a
 * season and then breaks every match and matchday belonging to it. The SCHEMA is what produces the
 * message, because the action validates the payload and returns the field error the form renders.
 */
export const SAISON_ID_LENGTH = 4;
