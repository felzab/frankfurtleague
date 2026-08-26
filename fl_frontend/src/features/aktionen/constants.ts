import type { FLAktion } from "./schemas";

// Its own module and not an export of the `"use client"` view: every export of a client module
// becomes a client reference on the server side.
export const AKTIONEN_CRUD_COPY = {
  searchLabel: "Protokoll durchsuchen",
  searchPlaceholder: "Suchen nach Person, Datensatz oder Vorgangsnummer...",
  /** One per `AdminCrudView :: CrudEmptiness` value: each narrowing stage asks something different of the reader. */
  emptyForQuery: "Keine Änderungen für diese Suche gefunden.",
  emptyForFilters: "Keine Änderungen für diese Filter gefunden.",
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
  // Only the erasure states the log's side, because only it is true of every such row: a removal
  // that matched nothing keeps no image either, and the `Stand gesichert` badge already answers
  // that question per row rather than per operation.
  delete_many: "Gelöscht",
  erase_many: "Gelöscht, ohne Stand",
};

/**
 * The pairs `AdminSaisonsTable` carries, at the same `/15` fill. The fan-out and the bulk create take warning, having
 * touched records nobody named. Both removals take danger: they differ in what the log kept, never in severity.
 */
export const AKTION_OPERATION_TINTS: Record<FLAktion["operation"], string> = {
  insert: "bg-success/15 text-success-strong",
  insert_many: "bg-warning/15 text-warning-strong",
  patch_one: "bg-info/15 text-info-strong",
  patch_many: "bg-warning/15 text-warning-strong",
  delete_many: "bg-danger/15 text-danger-strong",
  erase_many: "bg-danger/15 text-danger-strong",
};
