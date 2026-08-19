import { deriveSlotHerkunft } from "@/features/spiele/utils";
import { typedObjectEntries } from "@/shared/utils/type";

import type { FLBracketFault, FLSpiel, FLSpielWithDraftFields } from "../spiele/schemas";
import type { ActionRequiredCategory } from "../spiele/types";

// Re-exported and not moved: it is declared in `spiele`, because it classifies a Spiel.
export type { ActionRequiredCategory };

/**
 * How far a category is from stopping the competition, which is the order the triage list works in.
 * `none` is not a queue: it is offered for lookup and is never something an admin empties.
 */
export type FLActionUrgency = "blocking" | "results" | "details" | "none";

/**
 * Declaration order is render order, which is urgency. `short` is what the strip shows — the full
 * names do not fit one row at any width; `name` is the full spelling and `desc` explains it.
 */
export const ACTION_REQUIRED_LABELS: Record<ActionRequiredCategory, { name: string; short: string; desc: string; urgency: FLActionUrgency }> = {
  bracket_fault: {
    name: "Fehlerhafte Verweise",
    short: "Verweise",
    desc: "KO-Spiele, deren Herkunft sich nicht auflösen lässt. Der Grund steht auf der Karte",
    urgency: "blocking",
  },
  besetzung_missing: {
    name: "Offene Besetzung",
    short: "Besetzung",
    desc: "KO-Spiele mit einer Seite ohne Mannschaft und ohne Herkunft. Diese Seite wird von niemandem gepflegt",
    urgency: "blocking",
  },
  ergebnis_pending: {
    name: "Ergebnis ausstehend",
    short: "Ergebnis",
    desc: "Spiele, die bereits gespielt wurden, aber kein eingetragenes Ergebnis haben",
    urgency: "results",
  },
  datum_missing: {
    name: "Fehlendes Datum",
    short: "Datum",
    desc: "Spiele ohne eingetragenes Datum",
    urgency: "details",
  },
  uhrzeit_missing: {
    name: "Fehlende Uhrzeit",
    short: "Uhrzeit",
    desc: "Spiele ohne eingetragene Uhrzeit",
    urgency: "details",
  },
  ort_missing: {
    name: "Fehlender Ort",
    short: "Ort",
    desc: "Spiele ohne eingetragenen Ort",
    urgency: "details",
  },
  schiedsrichter_missing: {
    name: "Fehlender Schiedsrichter",
    short: "Schiedsrichter",
    desc: "Spiele ohne eingetragenen Schiedsrichter",
    urgency: "details",
  },
  is_canceled: {
    name: "Abgesagt",
    short: "Abgesagt",
    desc: "Abgesagte Spiele. Nichts zu erledigen, sie stehen hier zum Nachschlagen",
    urgency: "none",
  },
};

/**
 * `is_canceled` is exclusive; the `*_missing` categories are not. `bracket_fault` is read, never
 * derived — the backend computes it over whole seasons. Both dates are `YYYY-MM-DD`, so `<` is
 * lexicographic and strict.
 */
export function categorizeActionRequired<T extends FLSpielWithDraftFields>(
  spiele: readonly T[],
  today: string,
  bracketFaults: readonly FLBracketFault[] = [],
): Record<ActionRequiredCategory, T[]> {
  // Keyed in the label table's order so `Object.keys` agrees with it, which a test asserts.
  const categorized: Record<ActionRequiredCategory, T[]> = {
    bracket_fault: [],
    besetzung_missing: [],
    ergebnis_pending: [],
    datum_missing: [],
    uhrzeit_missing: [],
    ort_missing: [],
    schiedsrichter_missing: [],
    is_canceled: [],
  };

  const faultedSpielIds = new Set(bracketFaults.map((fault) => fault.spiel_id));

  for (const spiel of spiele) {
    // Before the cancellation branch and not exclusive with it: broken wiring still feeds whatever
    // sits below the fixture.
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

export type FLActionRequiredSection = {
  category: ActionRequiredCategory;
  spiele: readonly FLSpiel[];
};

/**
 * One comparison serves every category: the earliest date is both the most overdue result and the
 * soonest fixture. Nulls last, for `sortByDate`'s reason — an unscheduled match belongs at the end.
 */
const compareByUrgencyWithin = (a: FLSpiel, b: FLSpiel): number => {
  if (a.datum !== b.datum) {
    if (a.datum === null) return 1;
    if (b.datum === null) return -1;
    return a.datum < b.datum ? -1 : 1;
  }

  return a.spiel_nr - b.spiel_nr;
};

/**
 * Walks `ACTION_REQUIRED_LABELS` and never the categorised record, so render order has exactly one
 * declaration. Empty categories are returned too — a section with nothing in it is a tab with a zero.
 */
export function buildActionRequiredSections({
  spiele,
  today,
  bracketFaults,
}: {
  spiele: FLSpiel[];
  today: string;
  bracketFaults: readonly FLBracketFault[];
}): readonly FLActionRequiredSection[] {
  const categorized = categorizeActionRequired(spiele, today, bracketFaults);

  return typedObjectEntries(ACTION_REQUIRED_LABELS).map(([category]) => ({
    category,
    spiele: [...categorized[category]].sort(compareByUrgencyWithin),
  }));
}
