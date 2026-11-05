import { dayOf } from "@/core/format";

import type { CalendarDay } from "@/core/format";
import type { FLSaisonAdmin } from "@/core/generated/client/types";

/**
 * What the season editor's fields hold: the season's two days, its rules, a no-show's award, and its two windows. A
 * count is the text typed, read as a figure by the save; a window with no day set is no window.
 */
export type SaisonValues = {
  start: CalendarDay | null;
  end: CalendarDay | null;
  winPoints: string;
  drawPoints: string;
  tiebreak: string;
  gruppen: string;
  teamsPerGruppe: string;
  qualifiers: string;
  maxKader: string;
  stufen: readonly string[];
  forfeitWinner: string;
  forfeitLoser: string;
  bewerbungStart: CalendarDay | null;
  bewerbungEnd: CalendarDay | null;
  registrierungEnd: CalendarDay | null;
  registrierungPaused: boolean;
};

/** The editor's values as a stored season gives them. */
export function valuesOf(saison: FLSaisonAdmin): SaisonValues {
  const { rules } = saison;
  return {
    start: dayOf(saison.start_date),
    end: dayOf(saison.end_date),
    winPoints: String(rules.win_points),
    drawPoints: String(rules.draw_points),
    tiebreak: rules.tiebreak_order,
    gruppen: String(rules.number_of_gruppen),
    teamsPerGruppe: String(rules.teams_per_gruppe),
    qualifiers: String(rules.qualifiers_per_gruppe),
    maxKader: String(rules.max_kadergroesse),
    stufen: rules.allowed_stufen,
    forfeitWinner: String(rules.forfeit_ergebnis.sieger_tore),
    forfeitLoser: String(rules.forfeit_ergebnis.verlierer_tore),
    bewerbungStart: dayOf(saison.bewerbung?.start ?? null),
    bewerbungEnd: dayOf(saison.bewerbung?.end ?? null),
    registrierungEnd: dayOf(saison.registrierung?.end ?? null),
    // `offen` is the link's own flag: false pauses it.
    registrierungPaused: saison.registrierung === null ? false : !saison.registrierung.offen,
  };
}
