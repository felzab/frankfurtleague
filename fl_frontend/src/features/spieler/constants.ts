import type { FLSpielerPosition, FLSpielerStufe } from "./schemas";

export const SPIELER_CRUD_COPY = {
  searchLabel: "Spieler suchen",
  searchPlaceholder: "Suchen nach Name, Team oder Nummer...",
} as const;

/** Ordered from the goal outwards, as a squad sheet reads. The closed set is `FLSpielerPositionSchema`'s. */
export const POSITION_OPTIONS: readonly FLSpielerPosition[] = ["Tor", "Abwehr", "Mittelfeld", "Angriff"];

/**
 * **A form offers a SEASON's `rules.erlaubte_stufen`, not this.** This is the vocabulary, and the
 * ordering authority a season's list is sorted against so no two seasons order alike.
 */
export const STUFE_OPTIONS: readonly FLSpielerStufe[] = ["E1", "E2", "Q1", "Q2", "Q3", "Q4"];

/** A season's allowed levels in the league's own order, so the picker never reads out of sequence. */
export function orderStufen(erlaubt: readonly FLSpielerStufe[]): FLSpielerStufe[] {
  return STUFE_OPTIONS.filter((stufe) => erlaubt.includes(stufe));
}

/**
 * The input carries the bound so the browser refuses a further keystroke; the SCHEMA is what
 * produces the message, because the action validates the payload and returns the field error.
 */
export const NUMMER_MAX_LENGTH = 4;

/**
 * `REQ-PURGE-001` in German, said once — the REPAIR rather than the state, which the Callout beside
 * the control carries. A race, somebody reactivating the player in another tab, then toasts the
 * sentence that control already showed.
 */
export const ERASURE_NEEDS_RETIREMENT =
  "Lege den Spieler zuerst still — in der Spielerliste, über „Stilllegen“ in seiner Zeile. Danach lässt er sich endgültig löschen.";

/**
 * `REQ-SQUAD-001` in German for a reader standing where it is repaired — the REPAIR rather than the
 * state, which the banner beside the control carries. `actions.ts` words it for a reader elsewhere,
 * and one sentence cannot point both ways.
 */
export const REACTIVATION_NEEDS_A_TEAM_IN_SAISON =
  "Reaktivieren lässt sich der Eintrag erst, wenn Du ihn oben im Bereich „Kader“ einem Team dieser Saison zuweist und speicherst.";

/**
 * The same refusal for a reader standing on the player LIST, where the repair is a page away and no
 * badge beside the row reports the state. The sibling above points within the editor's own page, so
 * one sentence cannot serve both readers.
 */
export const LIST_REACTIVATION_NEEDS_A_TEAM_IN_SAISON =
  "Das Team dieses Kadereintrags ist in dieser Saison nicht mehr dabei. Bearbeite den Spieler und weise den Eintrag " +
  "im Bereich „Kader“ einem Team dieser Saison zu.";
