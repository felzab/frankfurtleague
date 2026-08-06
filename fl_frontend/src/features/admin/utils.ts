/**
 * ADMIN · action-required derivation
 *
 * Sorts matches into the categories the action-required view renders. Pure derivation, no I/O — it is
 * a separate module from `queries.ts` so that non-caching code stays out of a `"use cache"` file
 * (ADR-0004).
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Declaration order in `ACTION_REQUIRED_LABELS` is render order; the view maps its entries
 *     straight into the accordion.
 *   • The category union stays a literal union, not an index signature. The accumulator below is
 *     fully keyed, so a mistyped category is a compile error rather than a crash on `undefined`.
 */

import type { FLBracketFault, FLSpiel } from "../spiele/schemas";
import type { ActionRequiredCategory } from "../spiele/types";

// Re-exported so the eight views and tests that already import the union from here keep working, and
// so this module stays the obvious place to look for it. It is DECLARED in `spiele`, because it
// classifies a Spiel and the edit page reads it too — see the note on the declaration.
export type { ActionRequiredCategory };

/**
 * Declaration order is render order — the view maps `typedObjectEntries` straight into the accordion.
 */
export const ACTION_REQUIRED_LABELS: Record<ActionRequiredCategory, { name: string; desc: string }> = {
  ergebnis_pending: {
    name: "Ergebnis ausstehend",
    desc: "Spiele, die bereits gespielt wurden, aber kein eingetragenes Ergebnis haben",
  },
  besetzung_missing: {
    name: "Offene Besetzung",
    desc: "KO-Spiele mit einer Seite ohne Mannschaft und ohne Herkunft. Diese Seite wird von niemandem gepflegt",
  },
  bracket_fault: {
    name: "Fehlerhafte Verweise",
    desc: "KO-Spiele, deren Herkunft sich nicht auflösen lässt. Die Gründe stehen über den Karten",
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
 * Three rules that are load-bearing and easy to "tidy" away:
 * - `is_canceled` is **exclusive** — a cancelled match is reported only as cancelled, never also as
 *   missing a date or a referee, because chasing details on a cancelled fixture is noise.
 * - the four `*_missing` categories are **not** exclusive — one match can appear in several.
 * - `bracket_fault` membership is **read, not derived**. The backend computes it over whole seasons
 *   (ADR-0047) and this list holds a filtered handful of matches, so nothing here could recompute it.
 *
 * `datum` and `today` are both `YYYY-MM-DD`, so the `<` comparison is lexicographic and correct.
 * It is strict: a match dated today with no result is not yet overdue.
 */
export function categorizeActionRequired(
  spiele: FLSpiel[],
  today: string,
  bracketFaults: readonly FLBracketFault[] = [],
): Record<ActionRequiredCategory, FLSpiel[]> {
  const categorized: Record<ActionRequiredCategory, FLSpiel[]> = {
    ergebnis_pending: [],
    besetzung_missing: [],
    bracket_fault: [],
    datum_missing: [],
    uhrzeit_missing: [],
    ort_missing: [],
    schiedsrichter_missing: [],
    is_canceled: [],
  };

  const faultedSpielIds = new Set(bracketFaults.map((fault) => fault.spiel_id));

  for (const spiel of spiele) {
    // Before the cancellation branch, and deliberately not exclusive with it: a cancelled fixture whose
    // wiring is broken still feeds whatever the bracket puts below it, so the fault outlives the
    // cancellation and chasing it is not the noise that keeps the other categories off this match.
    if (faultedSpielIds.has(spiel.id)) categorized.bracket_fault.push(spiel);

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

    // A knockout side with no team AND no source is filled by nothing: the resolution skips a slot
    // without a `quelle` by design (ADR-0042), so this is the one legal state that stays broken by
    // default — reported here so it surfaces before the fixture's date passes, not after
    // (ADR-0046). A Gruppenphase fixture is exempt: an unfilled schedule is not an orphaned slot,
    // and every group fixture legitimately carries no source forever. Mirrors the backend arm in
    // `get_spiele_action_required`.
    if (
      spiel.saison_phase !== "gruppenphase" &&
      ((spiel.team1 === null && spiel.team1_quelle === null) || (spiel.team2 === null && spiel.team2_quelle === null))
    ) {
      categorized.besetzung_missing.push(spiel);
    }
  }

  return categorized;
}
