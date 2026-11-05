import type { FLSonderereignis } from "@/core/generated/client/types";

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
