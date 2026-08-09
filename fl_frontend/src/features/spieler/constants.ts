/**
 * SPIELER · admin page copy and picker options
 *
 * Its own module, not an export from a view: those files are `"use client"`, and every export of
 * a client module becomes a client reference on the server side.
 *
 * The page's name and explanation are the navigation structure's, which the shell's bar renders —
 * the title an admin reads is the nav item they clicked.
 */

import type { FLSpielerPosition, FLSpielerStufe } from "./schemas";

export const SPIELER_CRUD_COPY = {
  searchLabel: "Spieler suchen",
  searchPlaceholder: "Suchen nach Name, Team oder Nummer...",
} as const;

/**
 * The four positions, in the order every picker offers them: from the goal outwards, which is how a
 * squad sheet is read rather than alphabetically. The closed set is `FLSpielerPositionSchema`'s
 * (ADR-0061) and this constant only decides the order they are shown in.
 */
export const POSITION_OPTIONS: readonly FLSpielerPosition[] = ["Tor", "Abwehr", "Mittelfeld", "Angriff"];

/**
 * The league's six school levels, in the order the phases run.
 *
 * **A form offers a SEASON's `rules.erlaubte_stufen`, not this** (decided 2026-08-07): this is the
 * vocabulary and the season picks from it. Kept as the ordering authority — a season's list is
 * sorted against it, so two seasons never present the same levels in a different order — and as the
 * fallback for a caller with no season in hand.
 */
export const STUFE_OPTIONS: readonly FLSpielerStufe[] = ["E1", "E2", "Q1", "Q2", "Q3", "Q4"];

/** A season's allowed levels in the league's own order, so the picker never reads out of sequence. */
export function orderStufen(erlaubt: readonly FLSpielerStufe[]): FLSpielerStufe[] {
  return STUFE_OPTIONS.filter((stufe) => erlaubt.includes(stufe));
}

/**
 * What a squad number may be, enforced at the input as well as in the schema.
 *
 * Still a STRING on the wire (ADR-0061) — a number is worn rather than counted, and it is not unique
 * within a squad — but digits only and at most four of them (decided 2026-08-07). The input carries
 * the bound so the browser refuses a fifth keystroke; the SCHEMA is what produces the message, because
 * the server action validates the payload and returns the field error the form renders inline.
 */
export const NUMMER_MAX_LENGTH = 4;
