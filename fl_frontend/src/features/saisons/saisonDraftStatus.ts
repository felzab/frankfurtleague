import { STUFE_OPTIONS } from "@/features/spieler/constants";
import { deriveDraftStatus, emptyAsNull, numberAsNull } from "@/shared/utils/draftStatus";
import { formatSpielDatum } from "@/shared/utils/format";

import { tiebreakLabel } from "./constants";

import type { FLDraftStatus, FLFieldDescriptor } from "@/shared/utils/draftStatus";
import type { FieldErrors } from "@/shared/utils/validation";
import type { SaisonDraftFields } from "./types";

export type FLSaisonFieldGroup = "Zeitraum" | "Regeln" | "Bewerbung";

export type FLSaisonDraftStatus = FLDraftStatus<FLSaisonFieldGroup>;

/** Both halves or nothing: a forfeit result with one count entered is not a result the list can read out. */
const forfeitAsNull = ({ sieger_tore, verlierer_tore }: { sieger_tore: number | null; verlierer_tore: number | null }): string | null =>
  sieger_tore === null || verlierer_tore === null ? null : `${String(sieger_tore)}:${String(verlierer_tore)}`;

/** Every field the season editor can change, in the order the change list reads them. */
const FIELD_DESCRIPTORS: readonly FLFieldDescriptor<SaisonDraftFields, FLSaisonFieldGroup>[] = [
  { path: "start_date", label: "Beginn", group: "Zeitraum", read: (source) => emptyAsNull(source.start_date) },
  { path: "end_date", label: "Ende", group: "Zeitraum", read: (source) => emptyAsNull(source.end_date) },
  {
    path: "rules.win_points",
    label: "Punkte für einen Sieg",
    group: "Regeln",
    read: (source) => numberAsNull(source.rules.win_points),
  },
  {
    path: "rules.draw_points",
    label: "Punkte für ein Unentschieden",
    group: "Regeln",
    read: (source) => numberAsNull(source.rules.draw_points),
  },
  {
    path: "rules.tiebreak_order",
    label: "Tiebreak",
    group: "Regeln",
    read: (source) => tiebreakLabel(source.rules.tiebreak_order),
  },
  {
    path: "rules.forfeit_ergebnis",
    label: "Wertung bei Nichtantreten",
    group: "Regeln",
    // One row over both sides: the season regulates them together, so a row per number would report
    // half a decision. `errorPaths` is what still lands each field's own message on it.
    read: (source) => forfeitAsNull(source.rules.forfeit_ergebnis),
    errorPaths: ["rules.forfeit_ergebnis", "rules.forfeit_ergebnis.sieger_tore", "rules.forfeit_ergebnis.verlierer_tore"],
  },
  {
    path: "rules.number_of_groups",
    label: "Gruppen",
    group: "Regeln",
    read: (source) => numberAsNull(source.rules.number_of_groups),
  },
  {
    path: "rules.teams_per_group",
    label: "Teams pro Gruppe",
    group: "Regeln",
    read: (source) => numberAsNull(source.rules.teams_per_group),
  },
  {
    path: "rules.qualifiers_per_group",
    label: "Qualifikanten pro Gruppe",
    group: "Regeln",
    read: (source) => numberAsNull(source.rules.qualifiers_per_group),
  },
  {
    path: "rules.max_kadergroesse",
    label: "Maximale Kadergröße",
    group: "Regeln",
    read: (source) => numberAsNull(source.rules.max_kadergroesse),
  },
  {
    path: "rules.erlaubte_stufen",
    label: "Erlaubte Stufen",
    group: "Regeln",
    // Read in the LEAGUE's order, so pressing a level off and back on is not a change. Empty renders
    // as null, so clearing the last level reads as a removal — which it is, and the schema refuses it.
    read: (source) => {
      const ordered = STUFE_OPTIONS.filter((stufe) => source.rules.erlaubte_stufen.includes(stufe));
      return ordered.length === 0 ? null : ordered.join(", ");
    },
  },
  {
    path: "bewerbung",
    label: "Bewerbungsfrist",
    group: "Bewerbung",
    // ONE row over the whole window: opening it, moving it and freischalten are one decision about
    // when a school may apply, and a row per key would report a fragment of it.
    read: (source) => {
      const fenster = source.bewerbung;
      if (fenster === null) return null;

      // The freischaltung is IN the rendered value: flipping it changes nothing else, and a line
      // ignoring it would leave the save bar disabled on a real edit.
      const freigabe = fenster.offen ? "Freigeschaltet" : "Gesperrt";
      // Both fallbacks render a row rather than hiding one: an empty date is the mid-edit state the
      // schema refuses on save, and the change list is where the admin sees what is still missing.
      return `${freigabe}: ${formatSpielDatum(fenster.von)} bis ${formatSpielDatum(fenster.bis)}`;
    },
    errorPaths: ["bewerbung", "bewerbung.offen", "bewerbung.von", "bewerbung.bis"],
  },
];

export function deriveSaisonDraftStatus({
  stored,
  draft,
  fieldErrors,
}: {
  stored: SaisonDraftFields;
  draft: SaisonDraftFields;
  fieldErrors: FieldErrors;
}): FLSaisonDraftStatus {
  return deriveDraftStatus({ descriptors: FIELD_DESCRIPTORS, stored, draft, fieldErrors });
}
