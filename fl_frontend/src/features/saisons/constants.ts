import type { FLSaisonPhase, FLSaisonTiebreakOrder } from "./schemas";

export const SAISONS_CRUD_COPY = {
  searchLabel: "Saison suchen",
  searchPlaceholder: "z.B. 2526",
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

/** One step of the chain, as the picker renders it under the trigger. */
export type TiebreakRung = {
  /** What this step compares. */
  readonly label: string;
  /** The condition this step decides under, plus what happens without it, or `null` where it always decides. */
  readonly caveat: string | null;
};

type TiebreakOption = {
  readonly value: FLSaisonTiebreakOrder;
  /** Names the CRITERION, for the picker's trigger and the change list. */
  readonly label: string;
  /**
   * The whole chain in this option's order, mirroring
   * `fl_backend/app/api/teams/services.py :: _break_tie`. **Bounded, ending in a stated tie**: that
   * function makes one pass and never walks back up.
   */
  readonly ladder: readonly TiebreakRung[];
};

/** The first rung of both chains: `_tiers` bands a group by points before `_break_tie` sees it. */
const PUNKTE_RUNG: TiebreakRung = { label: "Punkte", caveat: null };

/** The goal keys, in the order `_goal_key` reads them. */
const TORE_RUNG: TiebreakRung = { label: "Tordifferenz, dann Tore aus allen Spielen", caveat: null };

/**
 * The two ways a season separates clubs level on points, in the picker's order. Both wordings live
 * here as one fact: a surface writing its own German would describe the same rule differently.
 */
export const TIEBREAK_ORDER_OPTIONS: readonly TiebreakOption[] = [
  {
    value: "tordifferenz",
    label: "Tordifferenz",
    ladder: [
      PUNKTE_RUNG,
      TORE_RUNG,
      {
        label: "Die Spiele der punktgleichen Teams untereinander",
        // `_break_tie` recomputes the mini-table over the teams still level and drops it whole where
        // they have not all met, so what is left below this rung is a genuine tie.
        caveat: "Nur wenn alle schon gegeneinander gespielt haben.",
      },
    ],
  },
  {
    value: "direkter_vergleich",
    label: "Direkter Vergleich",
    ladder: [
      PUNKTE_RUNG,
      {
        label: "Die Spiele der punktgleichen Teams untereinander",
        // An incomplete head-to-head sets `lead_table` back to `None`, which is exactly the chain
        // above: the goal keys lead and the mini-table follows them.
        caveat: "Nur wenn alle schon gegeneinander gespielt haben. Sonst führt die Tordifferenz.",
      },
      TORE_RUNG,
    ],
  },
];

/** What both chains end in, stated rather than implied: `_break_tie` reports a set it cannot split as one tie. */
export const TIEBREAK_LADDER_TAIL = "Bleibt es gleich, stehen die Teams gleichauf.";

// The find cannot miss: the parse refuses anything outside the closed set before a render sees it.
const tiebreakOption = (value: FLSaisonTiebreakOrder): TiebreakOption | undefined =>
  TIEBREAK_ORDER_OPTIONS.find((option) => option.value === value);

/** The criterion's name — `Tordifferenz`, `Direkter Vergleich`. */
export function tiebreakLabel(value: FLSaisonTiebreakOrder): string {
  return tiebreakOption(value)?.label ?? "";
}

/** The chain this option applies, top rung first. */
export function tiebreakLadder(value: FLSaisonTiebreakOrder): readonly TiebreakRung[] {
  return tiebreakOption(value)?.ladder ?? [];
}

/**
 * `saisons._id` is the string every `saison_id` references, and `FLSpiel` and `FLSpieltag` require
 * exactly this length — a longer id validates as a season and breaks every row pointing at it.
 */
export const SAISON_ID_LENGTH = 4;

/**
 * Mirrors `fl_backend/app/api/saisons/services.py :: RECORDED_FACT_FIELDS`, which closes both draw windows. Two articles and not one joined list: German inflects the article and the
 * conjunction, so a builder would need to know which sentence it is in.
 */
export const RECORDED_FACTS_NONE =
  "kein Ergebnis, kein Ausfall, kein Ort, kein Schiedsrichter, keine Notiz und keine von Hand geänderte Herkunft";
export const RECORDED_FACTS_ANY = "ein Ergebnis, ein Ausfall, ein Ort, ein Schiedsrichter, eine Notiz oder eine von Hand geänderte Herkunft";
