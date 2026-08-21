import type { FLAktion } from "./schemas";

// Its own module and not an export of the `"use client"` view: every export of a client module
// becomes a client reference on the server side.
export const AKTIONEN_CRUD_COPY = {
  searchLabel: "Protokoll durchsuchen",
  searchPlaceholder: "Suchen nach Person, Datensatz oder Vorgangsnummer...",
  /** Two empty states, because a list filtered down to nothing and an empty log ask different things of the reader. */
  emptyForQuery: "Keine Änderungen für diese Suche gefunden.",
  emptyOverall: "Es wurde noch keine Änderung aufgezeichnet.",
} as const;

/**
 * Read through `fl_frontend/src/features/aktionen/utils.ts :: labelForCollection`, never indexed
 * directly: the backend types this field as an open string, so an unknown name must render as itself.
 */
export const AKTION_COLLECTION_LABELS: Record<string, string> = {
  saisons: "Saisons",
  saison_teams: "Team in Saison",
  saison_spieler: "Spieler in Saison",
  spiele: "Spiele",
  spieltage: "Spieltage",
  teams: "Teams",
  spieler: "Spieler",
  spielorte: "Spielorte",
  schiedsrichter: "Schiedsrichter",
};

/**
 * What each operation is called. **Rendered as a tag beside the area's own tag and never in one sentence with it**: the
 * nine area names carry three grammatical genders, so a sentence agreeing with the value is wrong for most of them.
 */
export const AKTION_OPERATION_LABELS: Record<FLAktion["operation"], string> = {
  insert: "Angelegt",
  insert_many: "Mehrere angelegt",
  patch_one: "Geändert",
  patch_many: "Sammeländerung",
};

/**
 * The pairs `AdminSaisonsTable` already carries, at the same `/15` fill with its `-strong` ink. The two
 * fan-outs take the warning pair, because they are the rows that touched records nobody named, so they ask to be read
 * rather than skimmed.
 */
export const AKTION_OPERATION_TINTS: Record<FLAktion["operation"], string> = {
  insert: "bg-success/15 text-success-strong",
  insert_many: "bg-warning/15 text-warning-strong",
  patch_one: "bg-info/15 text-info-strong",
  patch_many: "bg-warning/15 text-warning-strong",
};
