import { SPIELBERICHT_ZUSTAENDE_OFFEN } from "@/features/spielberichte/constants";
import {
  geltendeBestaetigungen,
  groupBestaetigungenBySpielId,
  istSofortFaellig,
  istUeberfaellig,
  istVorschlagOffen,
  schiedsrichterAbsage,
  terminText,
} from "@/features/spielbestaetigungen/utils";
import { deriveSlotHerkunft, isAbgesagt } from "@/features/spiele/utils";
import { formatSpielDatum, NICHT_HINTERLEGT } from "@/shared/utils/format";
import { typedObjectEntries } from "@/shared/utils/type";

import type { FLSpielbestaetigung } from "@/features/spielbestaetigungen/schemas";
import type { FLSpielberichtZustandEintrag } from "../spielberichte/schemas";
import type { FLBracketFault, FLSpiel, FLSpielWithStoredSides } from "../spiele/schemas";
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
    // „Paarung“ and never „Aufstellung“: the site stores a starting line-up too, and that is the squad
    // a club fields rather than the two sides it plays (`docs/glossary.md :: Paarung`).
    name: "Fehlerhafte Verweise, Paarungen und Einteilungen",
    short: "Fehler",
    desc: "Spiele, deren Herkunft kein Team ergibt, deren Paarung nicht zulässig ist oder deren Spielort oder Schiedsrichter stillgelegt oder doppelt eingeteilt ist",
    urgency: "blocking",
  },
  besetzung_missing: {
    name: "Offene Besetzung",
    short: "Besetzung",
    desc: "KO-Spiele mit einer Seite ohne Team und ohne Herkunft",
    urgency: "blocking",
  },
  vorschlag_offen: {
    name: "Offene Terminvorschläge",
    short: "Vorschlag",
    desc: "Spiele, für die ein Team einen anderen Termin vorgeschlagen hat, der weder übernommen noch verworfen ist",
    urgency: "blocking",
  },
  bestaetigung_ueberfaellig: {
    name: "Bestätigung überfällig",
    short: "Überfällig",
    desc: "Spiele, bei denen ein Team bis zur Frist nicht geantwortet hat",
    urgency: "results",
  },
  // Never „Heute“ for `short`: the status chip on the same cards says that of a fixture played today.
  bestaetigung_sofort: {
    name: "Bestätigung heute fällig",
    short: "Sofort",
    desc: "Spiele, die die Teams noch am Tag der Anfrage bestätigen müssen",
    urgency: "results",
  },
  ergebnis_pending: {
    name: "Ergebnis ausstehend",
    short: "Ergebnis",
    desc: "Spiele, die gespielt sind und noch kein Ergebnis haben",
    urgency: "results",
  },
  ergebnis_vorschlag: {
    name: "Ergebnis vorgeschlagen",
    short: "Bericht",
    desc: "Spiele mit einem Spielbericht, dessen Ergebnis noch nicht übernommen ist oder der sich seit der Übernahme geändert hat",
    urgency: "results",
  },
  datum_missing: {
    name: "Fehlendes Datum",
    short: "Datum",
    desc: "Spiele ohne Datum",
    urgency: "details",
  },
  uhrzeit_missing: {
    name: "Fehlende Uhrzeit",
    short: "Uhrzeit",
    desc: "Spiele ohne Uhrzeit",
    urgency: "details",
  },
  ort_missing: {
    name: "Fehlender Ort",
    short: "Ort",
    desc: "Spiele ohne Ort",
    urgency: "details",
  },
  schiedsrichter_missing: {
    name: "Fehlender Schiedsrichter",
    short: "Schiedsrichter",
    desc: "Spiele ohne Schiedsrichter",
    urgency: "details",
  },
  // „Abgelehnt“ as the confirmation chip says every decline, never „Absage“ beside the called-off tab's „Abgesagt“.
  schiedsrichter_abgesagt: {
    name: "Schiedsrichter hat abgelehnt",
    short: "Abgelehnt",
    desc: "Spiele, deren eingeteilte Schiedsrichterin oder eingeteilter Schiedsrichter abgelehnt hat",
    urgency: "details",
  },
  abgesagt: {
    name: "Abgesagt",
    short: "Abgesagt",
    desc: "Ausgefallene, annullierte und nicht angetretene Spiele, nur zum Nachschlagen",
    urgency: "none",
  },
};

/**
 * `abgesagt` is exclusive; the `*_missing` categories are not. `bracket_fault` is read, never
 * derived — the backend computes it over whole seasons. Both dates are `YYYY-MM-DD`, so `<` is
 * lexicographic and strict.
 */
export function categorizeActionRequired<
  // Base-tier: no rule here reads a rent or a fee, and asking for one would bar the triage list,
  // whose fixtures come from a read that serves neither.
  T extends FLSpielWithStoredSides,
>(
  spiele: readonly T[],
  today: string,
  bracketFaults: readonly FLBracketFault[] = [],
  // The season's rows, as `bracketFaults` read, never derived: the editor passes none for the reason it passes no faults.
  bestaetigungen: readonly FLSpielbestaetigung[] = [],
  // Read, never derived, as the faults are: the backend judges a report against the stored result and its adoption.
  spielberichte: readonly Pick<FLSpielberichtZustandEintrag, "spiel_id" | "zustand">[] = [],
): Record<ActionRequiredCategory, T[]> {
  // Keyed in the label table's order so `Object.keys` agrees with it, which a test asserts.
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

  const faultedSpielIds = new Set(bracketFaults.map((fault) => fault.spiel_id));
  const bestaetigungenBySpielId = groupBestaetigungenBySpielId(bestaetigungen);
  // The states awaiting the administrator, by name: a report on a fixture called off since reads `abgesagt`, and the
  // fixture already sits under „Abgesagt“ with nothing to adopt.
  const vorgeschlageneSpielIds = new Set(
    spielberichte.filter((bericht) => SPIELBERICHT_ZUSTAENDE_OFFEN.has(bericht.zustand)).map((bericht) => bericht.spiel_id),
  );

  for (const spiel of spiele) {
    // Keyed on the faulted id alone, never on the reason, so a fault variant added to the union
    // lands here rather than falling through. Not exclusive with the branch below: a faulted
    // fixture still feeds whatever sits under it.
    if (faultedSpielIds.has(spiel.id)) categorized.bracket_fault.push(spiel);
    if (vorgeschlageneSpielIds.has(spiel.id)) categorized.ergebnis_vorschlag.push(spiel);

    // `isAbgesagt` rather than a second spelling of the four events: two lists of them are invisible
    // until they part, and this list would then disagree with the card about whether a fixture
    // happened.
    if (isAbgesagt(spiel.sonderereignis)) {
      categorized.abgesagt.push(spiel);
      continue;
    }

    if (spiel.datum === null) categorized.datum_missing.push(spiel);
    if (spiel.uhrzeit === null) categorized.uhrzeit_missing.push(spiel);
    if (spiel.ort === null) categorized.ort_missing.push(spiel);
    if (spiel.schiedsrichter === null) categorized.schiedsrichter_missing.push(spiel);
    if (schiedsrichterAbsage(bestaetigungenBySpielId.get(spiel.id) ?? [], spiel) !== undefined) {
      categorized.schiedsrichter_abgesagt.push(spiel);
    }

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

    const zeilen = geltendeBestaetigungen(bestaetigungenBySpielId.get(spiel.id) ?? [], spiel);
    if (zeilen.some(istVorschlagOffen)) categorized.vorschlag_offen.push(spiel);
    if (zeilen.some((zeile) => istUeberfaellig(zeile, today))) categorized.bestaetigung_ueberfaellig.push(spiel);
    if (zeilen.some((zeile) => istSofortFaellig(zeile, today))) categorized.bestaetigung_sofort.push(spiel);
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
  bestaetigungen,
  spielberichte,
}: {
  spiele: FLSpiel[];
  today: string;
  bracketFaults: readonly FLBracketFault[];
  bestaetigungen: readonly FLSpielbestaetigung[];
  spielberichte: readonly FLSpielberichtZustandEintrag[];
}): readonly FLActionRequiredSection[] {
  const categorized = categorizeActionRequired(spiele, today, bracketFaults, bestaetigungen, spielberichte);

  return typedObjectEntries(ACTION_REQUIRED_LABELS).map(([category]) => ({
    category,
    spiele: [...categorized[category]].sort(compareByUrgencyWithin),
  }));
}

/**
 * Each club's note beside a card in the two confirmation categories, keyed by `spiel_id`: their tabs name neither club
 * nor date. A row never mailed says so, or a club nobody reached reads as silent.
 */
export function bestaetigungNotizen(
  category: "vorschlag_offen" | "bestaetigung_ueberfaellig",
  spiele: readonly FLSpiel[],
  bestaetigungen: readonly FLSpielbestaetigung[],
  today: string,
): ReadonlyMap<string, readonly string[]> {
  const bySpielId = groupBestaetigungenBySpielId(bestaetigungen);

  return new Map(
    spiele.map((spiel) => {
      const teamName = (teamId: string): string =>
        [spiel.team1, spiel.team2].find((seite) => seite?.team_id === teamId)?.name ?? NICHT_HINTERLEGT;

      const saetze = geltendeBestaetigungen(bySpielId.get(spiel.id) ?? [], spiel).flatMap((zeile) => {
        if (zeile.partei.art !== "team") return [];
        const team = teamName(zeile.partei.team_id);

        if (category === "vorschlag_offen") {
          return istVorschlagOffen(zeile) && zeile.antwort?.vorschlag ? [`Vorschlag von ${team}: ${terminText(zeile.antwort.vorschlag)}`] : [];
        }
        if (!istUeberfaellig(zeile, today)) return [];
        return [
          zeile.angefragt_am === null
            ? `${team}: Anfrage nicht verschickt`
            : `${team}: angefragt am ${formatSpielDatum(zeile.angefragt_am)}, keine Antwort`,
        ];
      });

      return [spiel.id, saetze] as const;
    }),
  );
}
