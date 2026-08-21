import type { FLSaisonPhase, FLSaisonTiebreakOrder } from "./schemas";

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

type TiebreakOption = {
  readonly value: FLSaisonTiebreakOrder;
  /** Names the CRITERION, for the picker's trigger and the change list. */
  readonly label: string;
  /** What it does, mirroring `fl_backend/app/api/teams/services.py :: _break_tie`: it leads on this criterion and applies the other after. */
  readonly hint: string;
};

/**
 * The two ways a season separates clubs level on points, in the picker's order. Both wordings live
 * here as one fact: a surface writing its own German would describe the same rule differently.
 */
export const TIEBREAK_ORDER_OPTIONS: readonly TiebreakOption[] = [
  {
    value: "tordifferenz",
    label: "Tordifferenz",
    hint: "Erst Tordifferenz und Tore aus allen Spielen, dann die Spiele der punktgleichen Teams untereinander, sobald sie alle gegeneinander gespielt haben. Sonst bleibt es ein Gleichstand.",
  },
  {
    value: "direkter_vergleich",
    label: "Direkter Vergleich",
    hint: "Erst die Spiele der punktgleichen Teams untereinander, sobald sie alle gegeneinander gespielt haben. Sonst zuerst Tordifferenz und Tore aus allen Spielen, darunter wieder das direkte Duell.",
  },
];

// The find cannot miss: the parse refuses anything outside the closed set before a render sees it.
const tiebreakOption = (value: FLSaisonTiebreakOrder): TiebreakOption | undefined =>
  TIEBREAK_ORDER_OPTIONS.find((option) => option.value === value);

/** The criterion's name — `Tordifferenz`, `Direkter Vergleich`. */
export function tiebreakLabel(value: FLSaisonTiebreakOrder): string {
  return tiebreakOption(value)?.label ?? "";
}

/** The sentence under the picker, and beside each row it offers. */
export function tiebreakHint(value: FLSaisonTiebreakOrder): string {
  return tiebreakOption(value)?.hint ?? "";
}

/**
 * `saisons._id` is the string every `saison_id` references, and `FLSpiel` and `FLSpieltag` require
 * exactly this length — a longer id validates as a season and breaks every row pointing at it.
 */
export const SAISON_ID_LENGTH = 4;
