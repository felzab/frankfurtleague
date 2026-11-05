import { deriveSlotHerkunft, isAbgesagt } from "@/features/spiele/utils";

import type { ActionRequiredCategory, FLSpielWithStoredSides } from "../spiele/types";

// Re-exported and not moved: it is declared in `spiele`, because it classifies a Spiel.
export type { ActionRequiredCategory };

/**
 * What one fixture lacks by its own fields, for the match editor's draft: a season's faults, confirmations and
 * reports are the Übersicht's, judged by the backend over the whole season, so their categories stay empty here.
 * `abgesagt` is exclusive; the `*_missing` categories are not. Both dates are `YYYY-MM-DD`, so `<` is lexicographic
 * and strict.
 */
export function categorizeActionRequired<
  // Base-tier: no rule here reads a rent or a fee, and asking for one would bar a draft whose fixture serves neither.
  T extends FLSpielWithStoredSides,
>(spiele: readonly T[], today: string): Record<ActionRequiredCategory, T[]> {
  const categorized: Record<ActionRequiredCategory, T[]> = {
    bracket_fault: [],
    besetzung_missing: [],
    vorschlag_offen: [],
    bestaetigung_ueberfaellig: [],
    bestaetigung_sofort: [],
    ergebnis_pending: [],
    ergebnis_vorschlag: [],
    datum_missing: [],
    uhrzeit_missing: [],
    ort_missing: [],
    schiedsrichter_missing: [],
    schiedsrichter_abgesagt: [],
    abgesagt: [],
  };

  for (const spiel of spiele) {
    // `isAbgesagt` rather than a second spelling of the four events: two lists of them are invisible
    // until they part, and the editor would then disagree with the card about whether a fixture
    // happened.
    if (isAbgesagt(spiel.sonderereignis)) {
      categorized.abgesagt.push(spiel);
      continue;
    }

    if (spiel.datum === null) categorized.datum_missing.push(spiel);
    if (spiel.uhrzeit === null) categorized.uhrzeit_missing.push(spiel);
    if (spiel.ort === null) categorized.ort_missing.push(spiel);
    if (spiel.schiedsrichter === null) categorized.schiedsrichter_missing.push(spiel);

    if (spiel.datum !== null && spiel.datum < today && spiel.ergebnis === null) {
      categorized.ergebnis_pending.push(spiel);
    }

    // Gruppenphase is exempt: the resolution only fills a slot holding a `quelle`, and that phase has
    // none. Via `deriveSlotHerkunft`, so this and the wiring review cannot spell `offen` twice.
    if (
      spiel.saison_phase !== "gruppenphase" &&
      (deriveSlotHerkunft({ team: spiel.team1, quelle: spiel.team1_quelle }) === "offen" ||
        deriveSlotHerkunft({ team: spiel.team2, quelle: spiel.team2_quelle }) === "offen")
    ) {
      categorized.besetzung_missing.push(spiel);
    }
  }

  return categorized;
}
