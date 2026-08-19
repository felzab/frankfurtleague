import type { FLSaisonPhase } from "./schemas";

export const SAISONS_CRUD_COPY = {
  searchLabel: "Saison suchen",
  searchPlaceholder: "Suchen nach Saison-ID oder Zeitraum...",
} as const;

/**
 * The five phases in the competition's own playing order, which `PHASE_RANK` in
 * `fl_frontend/src/features/spiele/utils.ts` ranks against. The schema owns the SET; this owns the
 * SEQUENCE.
 */
export const SAISON_PHASE_OPTIONS: readonly FLSaisonPhase[] = ["gruppenphase", "achtelfinale", "viertelfinale", "halbfinale", "finale"];

/**
 * The one German spelling of each phase, for every surface. A `.ts` module and not an export from the
 * chip that renders them: the node test runner cannot load a `.tsx`, so nothing importing one could be
 * unit-tested.
 */
export const PHASE_LABELS: Record<FLSaisonPhase, string> = {
  gruppenphase: "Gruppenphase",
  achtelfinale: "Achtelfinale",
  viertelfinale: "Viertelfinale",
  halbfinale: "Halbfinale",
  finale: "Finale",
};

/**
 * The fill is the ink at `/10`, and the grade is measured rather than picked: at `/15` the tightest
 * light-theme pair falls below the 4.5:1 floor on `--bg-surface`.
 */
export const PHASE_TINTS: Record<FLSaisonPhase, string> = {
  gruppenphase: "bg-phase-gruppenphase/10 text-phase-gruppenphase",
  achtelfinale: "bg-phase-achtelfinale/10 text-phase-achtelfinale",
  viertelfinale: "bg-phase-viertelfinale/10 text-phase-viertelfinale",
  halbfinale: "bg-phase-halbfinale/10 text-phase-halbfinale",
  finale: "bg-phase-finale/10 text-phase-finale",
};

/**
 * `saisons._id` is the string every `saison_id` references, and `FLSpiel` and `FLSpieltag` require
 * exactly this length — a longer id validates as a season and breaks every row pointing at it.
 */
export const SAISON_ID_LENGTH = 4;
