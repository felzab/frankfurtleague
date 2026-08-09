/**
 * ADMIN · action-required derivation
 *
 * Sorts matches into the categories the action-required view renders, ranks them by how much
 * each blocks the competition, and says the one thing about an entry its category cannot. Pure,
 * no I/O — a separate module so non-caching code stays out of a `"use cache"` file (ADR-0003).
 *
 * Invariants:
 * - `ACTION_REQUIRED_LABELS` order is render order, which is urgency (ADR-0056), and
 *   `buildActionRequiredSections` walks the label table, so the two cannot split.
 * - The category union stays a literal union — a mistyped category is a compile error.
 * - `categorizeActionRequired` serves two surfaces, so its rules live here once.
 * - What fills a bracket slot is `deriveSlotHerkunft`'s answer, in `spiele`, beside the fields.
 */

import { deriveSlotHerkunft } from "@/features/spiele/utils";
import { typedObjectEntries } from "@/shared/utils/type";

import type { FLBracketFault, FLSpiel, FLSpielWithStoredSides } from "../spiele/schemas";
import type { ActionRequiredCategory } from "../spiele/types";

// Re-exported so the eight views and tests that already import the union from here keep working, and
// so this module stays the obvious place to look for it. It is DECLARED in `spiele`, because it
// classifies a Spiel and the edit page reads it too — see the note on the declaration.
export type { ActionRequiredCategory };

/**
 * How far a category is from stopping the competition, which is the order the triage list works in
 * (ADR-0056). The three working grades also carry the colour, so a section's rank and its tint can
 * never disagree.
 *
 * - `blocking` — a later fixture cannot resolve at all until somebody acts.
 * - `results` — every standing and every group-seeded slot below this fixture is waiting on it.
 * - `details` — administrative tidying. Nothing downstream is held up.
 * - `none` — not a problem. `is_canceled` is the only member: it is a filter over the season, offered
 *   here so an admin can look it up, and never a queue an admin is expected to empty.
 */
export type FLActionUrgency = "blocking" | "results" | "details" | "none";

/**
 * Declaration order is render order, and it is urgency rather than the data model's grouping —
 * established platforms order an organiser's queue by what blocks play, and that is the order below.
 *
 * **`short` is what the page shows and `name` is what it is called.** Eight tabs are rendered at all
 * times (ADR-0056), and eight full names do not fit one row at any width — the one-word form does, at
 * desktop width, which is what lets the strip be a strip rather than a scroller. `name` stays because
 * a category needs a full spelling somewhere a reader can find it, and `desc` is the line under the
 * strip that says what the one word covers.
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
export function categorizeActionRequired<T extends FLSpielWithStoredSides>(
  spiele: readonly T[],
  today: string,
  bracketFaults: readonly FLBracketFault[] = [],
): Record<ActionRequiredCategory, T[]> {
  // Keyed in the label table's order, so `Object.keys` on the result and on the table agree — the
  // property one test asserts, and what lets a caller walk either one.
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
    //
    // `deriveSlotHerkunft` rather than the two null checks spelled out here: the wiring review badges
    // the same three states per slot, and two spellings of `offen` is how that page and this one come
    // to disagree about which fixtures need somebody.
    if (
      spiel.saison_phase !== "gruppenphase" &&
      (deriveSlotHerkunft(spiel.team1, spiel.team1_quelle) === "offen" || deriveSlotHerkunft(spiel.team2, spiel.team2_quelle) === "offen")
    ) {
      categorized.besetzung_missing.push(spiel);
    }
  }

  return categorized;
}

/** One category and the matches under it, ranked. Every category is returned, empty ones included. */
export type FLActionRequiredSection = {
  category: ActionRequiredCategory;
  spiele: readonly FLSpiel[];
};

/**
 * Within a section, the fixture whose clock has run longest comes first.
 *
 * One rule serves every category because the same comparison means the right thing in each: for an
 * outstanding result the earliest date is the most overdue, for a fixture still to be played it is the
 * one arriving soonest, and where no fixture has a date at all — the whole `datum_missing` section —
 * the tie-break carries it and the order is the bracket's own. Nulls sort last for the reason
 * `sortByDate` gives: an unscheduled match belongs at the end of a fixture list, not at the top.
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
 * Every category as a section, in urgency order, with the matches inside each one ranked.
 *
 * **It walks `ACTION_REQUIRED_LABELS`, never the categorised record**, so the render order has exactly
 * one declaration. The two are keyed identically today and this does not depend on that staying true.
 *
 * Every category is returned, including the empty ones: the strip shows all eight at all times
 * (ADR-0056), so a section with nothing in it is a tab with a zero rather than something to omit.
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
