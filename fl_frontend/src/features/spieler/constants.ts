/**
 * Search copy and the picker options for the Spieler admin page.
 *
 * Its own module, not an export from a view: those files are `"use client"`, and every export of a
 * client module becomes a client reference on the server side.
 *
 * The page's name and its explanation are NOT here — they are the navigation structure's, which the
 * shell's bar renders, so the title an admin reads is the nav item they clicked.
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

/** The six school levels, in the order the phases run. `E2` is offered although no row holds it yet. */
export const STUFE_OPTIONS: readonly FLSpielerStufe[] = ["E1", "E2", "Q1", "Q2", "Q3", "Q4"];

/**
 * What a squad number may be, enforced at the input as well as in the schema.
 *
 * Free text by decision (ADR-0061) — a number is worn rather than counted, and it is not unique
 * within a squad — so this bounds the LENGTH and nothing else. Three characters covers every number
 * anyone wears without letting a name be typed into the box.
 */
export const NUMMER_MAX_LENGTH = 3;
