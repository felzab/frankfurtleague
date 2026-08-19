import { STUFE_OPTIONS } from "@/features/spieler/constants";
import { deriveDraftStatus } from "@/shared/utils/draftStatus";

import type { FLDraftStatus, FLFieldDescriptor, FLFieldStatus } from "@/shared/utils/draftStatus";
import type { FieldErrors } from "@/shared/utils/validation";
import type { SaisonDraftFields } from "./types";

export type FLSaisonFieldGroup = "Zeitraum" | "Regeln";

export type FLSaisonFieldStatus = FLFieldStatus<FLSaisonFieldGroup>;

export type FLSaisonDraftStatus = FLDraftStatus<FLSaisonFieldGroup>;

const emptyAsNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());

/** Every field the season editor can change, in the order the change list reads them. */
const FIELD_DESCRIPTORS: readonly FLFieldDescriptor<SaisonDraftFields, FLSaisonFieldGroup>[] = [
  { path: "start_date", label: "Beginn", group: "Zeitraum", read: (source) => emptyAsNull(source.start_date) },
  { path: "end_date", label: "Ende", group: "Zeitraum", read: (source) => emptyAsNull(source.end_date) },
  {
    path: "rules.win_points",
    label: "Punkte für einen Sieg",
    group: "Regeln",
    read: (source) => String(source.rules.win_points),
  },
  {
    path: "rules.draw_points",
    label: "Punkte für ein Unentschieden",
    group: "Regeln",
    read: (source) => String(source.rules.draw_points),
  },
  {
    path: "rules.number_of_groups",
    label: "Gruppen",
    group: "Regeln",
    read: (source) => String(source.rules.number_of_groups),
  },
  {
    path: "rules.teams_per_group",
    label: "Teams pro Gruppe",
    group: "Regeln",
    read: (source) => String(source.rules.teams_per_group),
  },
  {
    path: "rules.qualifiers_per_group",
    label: "Qualifikanten pro Gruppe",
    group: "Regeln",
    read: (source) => String(source.rules.qualifiers_per_group),
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
