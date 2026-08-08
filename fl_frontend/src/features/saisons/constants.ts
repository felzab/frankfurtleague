/**
 * SAISONS · search copy, the season id's shape, and the phases' German names
 *
 * Its own module, not an export from a view: those files are `"use client"`, and every export of a
 * client module becomes a client reference on the server side.
 *
 * The page's name and its explanation are NOT here — they are the navigation structure's, which the
 * shell's bar renders, so the title an admin reads is the nav item they clicked (ADR-0058).
 */

import type { FLSaisonPhase } from "./schemas";

export const SAISONS_CRUD_COPY = {
  searchLabel: "Saison suchen",
  searchPlaceholder: "Suchen nach Saison-ID oder Zeitraum...",
} as const;

/**
 * What each `saison_phase` is called on screen — one German spelling of the five, for every surface.
 *
 * **In this slice because `FLSaisonPhaseSchema` is**, and a label belongs beside the set it labels: both
 * `spiele` and `spieltage` already import the phase type from here, so reading its names from the same
 * place adds no edge to the import graph. It lived in `SaisonPhaseChip.tsx` until 2026-08-07 and moved
 * for a concrete reason rather than tidiness — a `.tsx` module cannot be loaded by the node test runner,
 * so nothing importing it could be unit-tested.
 */
/**
 * The five phases in the order a season runs them: the order the admin list sections them in, the order
 * the picker offers them, and the order `PHASE_RANK` in `fl_frontend/src/features/spiele/utils.ts`
 * derives its comparison from.
 *
 * **The schema owns the SET and this owns the SEQUENCE** — the same split `POSITION_OPTIONS` makes for
 * the player positions. It is the competition's own order rather than a presentation choice: a season
 * plays its group phase and then each knockout round in turn, which is why the bracket rules can rank
 * phases against it (ADR-0065).
 */
export const SAISON_PHASE_OPTIONS: readonly FLSaisonPhase[] = ["gruppenphase", "achtelfinale", "viertelfinale", "halbfinale", "finale"];

export const PHASE_LABELS: Record<FLSaisonPhase, string> = {
  gruppenphase: "Gruppenphase",
  achtelfinale: "Achtelfinale",
  viertelfinale: "Viertelfinale",
  halbfinale: "Halbfinale",
  finale: "Finale",
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
