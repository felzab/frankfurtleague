import type { FLSonderereignis, FLSpielStatus } from "./schemas";

/**
 * The note's bound, mirroring the backend's `SPIEL_NOTIZ_MAX_LENGTH`
 * (`fl_backend/app/shared/schemas/bounds.py`). Every frontend enforcement point reads it from
 * here, so no two can disagree about the cap.
 */
export const NOTIZ_MAX_LENGTH = 4096;

/**
 * The most fixtures one undo replays, mirroring the backend's `LIST_LIMIT_DEFAULT`
 * (`fl_backend/app/shared/schemas/bounds.py`), the season read's ceiling.
 */
export const PAARUNGEN_MAX = 1024;

/**
 * The days before its fixture a team's answer is due, mirroring the backend's
 * `SPIEL_BESTAETIGUNG_FRIST_TAGE` (`fl_backend/app/shared/schemas/bounds.py`). A row's own deadline
 * is the one it stores; this number only says whether a date is inside the notice period.
 */
export const SPIEL_BESTAETIGUNG_FRIST_TAGE = 7;

/**
 * The days before a deadline the confirmations' pass asks, mirroring the backend's `SPIEL_ANFRAGE_VORLAUF_TAGE`
 * (`fl_backend/app/shared/schemas/bounds.py`): with the deadline's days, how far ahead a fixture is asked about.
 */
export const SPIEL_ANFRAGE_VORLAUF_TAGE = 14;

/**
 * `fl_backend/app/api/spiele/services.py :: CLASH_BUFFER_MINUTES` in the words every clash sentence says it in.
 */
export const CLASH_BUFFER_TEXT = "vier Stunden";

/**
 * The reason box's bound on a fixture confirmation, mirroring the backend's
 * `SPIELBESTAETIGUNG_BEGRUENDUNG_MAX_LENGTH` (`fl_backend/app/shared/schemas/bounds.py`).
 */
export const SPIELBESTAETIGUNG_BEGRUENDUNG_MAX_LENGTH = 500;

/**
 * The one German spelling of each Sonderereignis. **A label table and never a predicate**: what a
 * member means differs per consumer, and each of those sets is written at its own call site.
 */
export const SONDEREREIGNIS_LABELS: Record<FLSonderereignis, string> = {
  ausgefallen: "Ausgefallen",
  nichtantreten_team1: "Nichtantreten Team 1",
  nichtantreten_team2: "Nichtantreten Team 2",
  abgebrochen: "Abgebrochen",
  annulliert: "Annulliert",
};

/**
 * The one German spelling of each derived status, read by the status chip and the status filter alike:
 * two spellings of one state read as two. Not the schema value, which would couple the visible German
 * to the API contract.
 */
export const SPIEL_STATUS_LABELS: Record<FLSpielStatus, string> = {
  ausstehend: "Ausstehend",
  heute: "Heute",
  vergangen: "Vergangen",
  abgesagt: "Abgesagt",
  unbekannt: "Ohne Datum",
};

/**
 * The word for a fixture carrying no event. Its own constant rather than a `null` key above: `null`
 * is the absence of an event, not a sixth one that a consumer could iterate.
 */
export const SONDEREREIGNIS_NONE_LABEL = "Regulär";

/**
 * Declaration order is the order the editor's control and the filter offer them — how often an admin
 * reaches for one, ending with the member that strikes a fixture from the record altogether.
 */
export const SONDEREREIGNIS_OPTIONS: readonly FLSonderereignis[] = [
  "ausgefallen",
  "nichtantreten_team1",
  "nichtantreten_team2",
  "abgebrochen",
  "annulliert",
];
