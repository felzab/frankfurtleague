import type { FLSpiel } from "../spiele/schemas";

/**
 * The six things that can make a match need admin attention.
 *
 * A literal union rather than a loose index signature: the categorisation below builds a fully
 * keyed accumulator, so every read is checked and a mistyped category is a compile error instead of
 * a runtime crash on `undefined.spiele`.
 */
export type ActionRequiredCategory =
  "ergebnis_pending" | "datum_missing" | "uhrzeit_missing" | "ort_missing" | "schiedsrichter_missing" | "is_canceled";

/**
 * Declaration order is render order — the view maps `typedObjectEntries` straight into the accordion.
 */
export const ACTION_REQUIRED_LABELS: Record<ActionRequiredCategory, { name: string; desc: string }> = {
  ergebnis_pending: {
    name: "Ergebnis ausstehend",
    desc: "Spiele, die bereits gespielt wurden, aber kein eingetragenes Ergebnis haben",
  },
  datum_missing: { name: "Fehlendes Datum", desc: "Spiele ohne eingetragenes Datum" },
  uhrzeit_missing: { name: "Fehlende Uhrzeit", desc: "Spiele ohne eingetragene Uhrzeit" },
  ort_missing: { name: "Fehlender Ort", desc: "Spiele ohne eingetragenen Ort" },
  schiedsrichter_missing: { name: "Fehlender Schiedsrichter", desc: "Spiele ohne eingetragenen Schiedsrichter" },
  is_canceled: { name: "Abgesagt", desc: "Abgesagte Spiele" },
};

/**
 * Sorts matches into the categories that need admin attention.
 *
 * Two rules that are load-bearing and easy to "tidy" away:
 * - `is_canceled` is **exclusive** — a cancelled match is reported only as cancelled, never also as
 *   missing a date or a referee, because chasing details on a cancelled fixture is noise.
 * - the four `*_missing` categories are **not** exclusive — one match can appear in several.
 *
 * `datum` and `today` are both `YYYY-MM-DD`, so the `<` comparison is lexicographic and correct.
 * It is strict: a match dated today with no result is not yet overdue.
 */
export function categorizeActionRequired(spiele: FLSpiel[], today: string): Record<ActionRequiredCategory, FLSpiel[]> {
  const categorized: Record<ActionRequiredCategory, FLSpiel[]> = {
    ergebnis_pending: [],
    datum_missing: [],
    uhrzeit_missing: [],
    ort_missing: [],
    schiedsrichter_missing: [],
    is_canceled: [],
  };

  for (const spiel of spiele) {
    if (spiel.is_canceled) {
      categorized.is_canceled.push(spiel);
      continue;
    }

    if (spiel.datum === null) categorized.datum_missing.push(spiel);
    if (spiel.uhrzeit === null) categorized.uhrzeit_missing.push(spiel);
    if (spiel.ort === null) categorized.ort_missing.push(spiel);
    if (spiel.schiedsrichter === null) categorized.schiedsrichter_missing.push(spiel);

    if (spiel.datum !== null && spiel.datum < today && spiel.ergebnis === null) {
      categorized.ergebnis_pending.push(spiel);
    }
  }

  return categorized;
}
