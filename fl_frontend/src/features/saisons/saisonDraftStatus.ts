import { STUFE_OPTIONS } from "@/features/spieler/constants";

import type { FieldErrors } from "@/shared/utils/validation";
import type { SaisonDraftFields } from "./types";

export type FLSaisonFieldGroup = "Zeitraum" | "Regeln";

export type FLSaisonFieldStatus = {
  path: string;
  label: string;
  group: FLSaisonFieldGroup;
  isChanged: boolean;
  error: string | null;
  storedText: string | null;
  draftText: string | null;
};

export type FLSaisonDraftStatus = {
  fields: readonly FLSaisonFieldStatus[];
  byPath: ReadonlyMap<string, FLSaisonFieldStatus>;
  changed: readonly FLSaisonFieldStatus[];
  invalid: readonly FLSaisonFieldStatus[];
  isDirty: boolean;
};

type FieldDescriptor = {
  /** Dotted payload path; also the input's `name`, the `FieldErrors` key and the anchor id. */
  path: string;
  label: string;
  group: FLSaisonFieldGroup;
  read: (source: SaisonDraftFields) => string | null;
  /** Widened where a schema reports a field's failures under several keys. Defaults to `[path]`. */
  errorPaths?: readonly string[];
};

const emptyAsNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());

/**
 * Every field the season editor can change, in the order the change list reads them. Each `read`
 * returns DISPLAY text, which doubles as the comparison key — so reordering `erlaubte_stufen` is
 * correctly not a change, while adding a level is.
 */
const FIELD_DESCRIPTORS: readonly FieldDescriptor[] = [
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
  const fields = FIELD_DESCRIPTORS.map((descriptor): FLSaisonFieldStatus => {
    const storedText = descriptor.read(stored);
    const draftText = descriptor.read(draft);
    const error =
      (descriptor.errorPaths ?? [descriptor.path]).map((path) => fieldErrors[path]).find((message) => message !== undefined) ?? null;

    return {
      path: descriptor.path,
      label: descriptor.label,
      group: descriptor.group,
      isChanged: storedText !== draftText,
      error,
      storedText,
      draftText,
    };
  });

  const changed = fields.filter((field) => field.isChanged);

  return {
    fields,
    byPath: new Map(fields.map((field) => [field.path, field])),
    changed,
    invalid: fields.filter((field) => field.error !== null),
    isDirty: changed.length > 0,
  };
}
