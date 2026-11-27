import { dayOf } from "@/core/format";

import type { CalendarDay } from "@/core/format";
import type { FLSaisonAdmin } from "@/core/generated/client/types";

/**
 * What the season editor's fields hold: the season's two days, its rules, a no-show's award, and its two windows. A
 * count is the text typed, read as a figure by the save; a window with no day set is no window. Each box is named by
 * the path the write names its field by, dots and all, so a refusal of that path lands on it; the two pauses alone are
 * the screen's, since the write holds each window's opposite, `open`.
 */
export type SaisonValues = {
  start_date: CalendarDay | null;
  end_date: CalendarDay | null;
  "rules.win_points": string;
  "rules.draw_points": string;
  "rules.loss_points": string;
  "rules.tiebreak_order": string;
  "rules.number_of_gruppen": string;
  "rules.teams_per_gruppe": string;
  "rules.qualifiers_per_gruppe": string;
  "rules.max_kader_size": string;
  "rules.allowed_stufen": readonly string[];
  "rules.forfeit_ergebnis.sieger_tore": string;
  "rules.forfeit_ergebnis.verlierer_tore": string;
  "bewerbung.start": CalendarDay | null;
  "bewerbung.end": CalendarDay | null;
  bewerbungPaused: boolean;
  "registrierung.end": CalendarDay | null;
  registrierungPaused: boolean;
};

export function valuesOf(saison: FLSaisonAdmin): SaisonValues {
  const { rules } = saison;
  return {
    start_date: dayOf(saison.start_date),
    end_date: dayOf(saison.end_date),
    "rules.win_points": String(rules.win_points),
    "rules.draw_points": String(rules.draw_points),
    "rules.loss_points": String(rules.loss_points),
    "rules.tiebreak_order": rules.tiebreak_order,
    "rules.number_of_gruppen": String(rules.number_of_gruppen),
    "rules.teams_per_gruppe": String(rules.teams_per_gruppe),
    "rules.qualifiers_per_gruppe": String(rules.qualifiers_per_gruppe),
    "rules.max_kader_size": String(rules.max_kader_size),
    "rules.allowed_stufen": rules.allowed_stufen,
    "rules.forfeit_ergebnis.sieger_tore": String(rules.forfeit_ergebnis.sieger_tore),
    "rules.forfeit_ergebnis.verlierer_tore": String(rules.forfeit_ergebnis.verlierer_tore),
    "bewerbung.start": dayOf(saison.bewerbung?.start ?? null),
    "bewerbung.end": dayOf(saison.bewerbung?.end ?? null),
    // `open` is the form's own flag: false pauses it.
    bewerbungPaused: saison.bewerbung === null ? false : !saison.bewerbung.open,
    "registrierung.end": dayOf(saison.registrierung?.end ?? null),
    // `open` is the link's own flag: false pauses it.
    registrierungPaused: saison.registrierung === null ? false : !saison.registrierung.open,
  };
}

/** A window's two days, as the editor names their boxes. */
type WindowDays = Readonly<Pick<Record<keyof SaisonValues, unknown>, "bewerbung.start" | "bewerbung.end">>;

const isEmpty = (day: unknown) => day === null || day === "";

/**
 * The boxes a save needs filled that are empty, by the editor's field names, judged on the season's values with the
 * editor's changes over them: a window with neither day is none, and one with a single day lacks the other. The
 * editor's draft holds the same values, so the browser's pass asks the same.
 */
export function requiredOf(days: WindowDays): readonly (keyof WindowDays)[] {
  const start = days["bewerbung.start"];
  const end = days["bewerbung.end"];
  if (isEmpty(start) === isEmpty(end)) return [];
  return isEmpty(start) ? ["bewerbung.start"] : ["bewerbung.end"];
}
