/**
 * SPIELTAGE · search copy and the phase order
 *
 * Its own module, not an export from a view: those files are `"use client"`, and every export of a
 * client module becomes a client reference on the server side.
 *
 * **No German labels here.** `PHASE_LABELS` in `fl_frontend/src/features/spiele/components/ui/SaisonPhaseChip.tsx`
 * is already the one spelling of the four phases and is exported for exactly this reason; a second
 * map would be a second answer to one question.
 */

import type { FLSaisonPhase } from "@/features/saisons/schemas";

export const SPIELTAGE_CRUD_COPY = {
  searchLabel: "Spieltag suchen",
  searchPlaceholder: "Suchen nach Name, Phase oder Datum...",
} as const;

/**
 * The four phases in the order a season runs them, which is the order the admin list sections them in
 * and the order the picker offers them.
 *
 * The closed set is `FLSaisonPhaseSchema`'s and this constant only decides the sequence — the same
 * split `POSITION_OPTIONS` makes for the player positions. A season plays its group phase and then
 * each knockout round in turn, so this order is the competition's rather than a presentation choice.
 */
export const SAISON_PHASE_OPTIONS: readonly FLSaisonPhase[] = ["gruppenphase", "viertelfinale", "halbfinale", "finale"];
