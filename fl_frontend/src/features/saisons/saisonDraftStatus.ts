/**
 * SAISONS · what the season editor's draft has changed and got wrong
 *
 * One derivation over one season's draft, read by everything on the edit page that says something
 * about a field: the label markers, the change list, the unsaved count, the action bar and the
 * navigation guard. Pure, so it is tested rather than clicked. `spielerDraftStatus.ts` is the pattern
 * and this is the same idea over a season.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • `path` is the field's dotted path in the payload, and the SAME string is the input's `name`, the
 *     `FieldErrors` key and the anchor id. One string joins the label, the change row, the error and
 *     the jump link.
 *   • Every editable field has a row in `FIELD_DESCRIPTORS` and nothing reads a field any other way. A
 *     field with no row is invisible to the whole page.
 *   • `status` is NOT a descriptor and cannot become one. The rollover is a control, not a field: it
 *     writes immediately through the one endpoint that may touch `status` and is never part of a draft
 *     the save bar counts (ADR-0033).
 *   • `id` is not one either. A season's id is the key every `saison_id` in the database references, so
 *     it is chosen once at create time and there is no edit that could move it.
 */

import { STUFE_OPTIONS } from "@/features/spieler/constants";

import type { FieldErrors } from "@/shared/utils/validation";
import type { SaisonDraftFields } from "./types";

/** The panel a field renders in — the change list's section heading. */
export type FLSaisonFieldGroup = "Zeitraum" | "Regeln";

/** What the page knows about one editable field right now. */
export type FLSaisonFieldStatus = {
  path: string;
  label: string;
  group: FLSaisonFieldGroup;
  isChanged: boolean;
  /** The schema's message for this field, or `null`. */
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
  path: string;
  label: string;
  group: FLSaisonFieldGroup;
  read: (source: SaisonDraftFields) => string | null;
  /** Widened where a schema reports a field's failures under several keys. Defaults to `[path]`. */
  errorPaths?: readonly string[];
};

const emptyAsNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());

/**
 * Every field the season editor can change, in the order the change list reads them.
 *
 * Each `read` returns the DISPLAY text, which doubles as the comparison key: every field here either
 * is a string or formats to one that changes exactly when the value does — so one function serves
 * `hasChanged`, `storedText` and `draftText`.
 *
 * `erlaubte_stufen` is the only field that is not a scalar, and it is why the reads are display text
 * rather than values: a list compares as the joined labels the picker showed, in the league's own
 * order, so reordering the same set is correctly not a change while adding a level is.
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
    // Read in the LEAGUE's order rather than the draft's, so pressing a level off and back on is not
    // a change. Empty renders as null, which makes clearing the last level a REMOVAL in the change
    // list — which is what it is, and the schema refuses it on save.
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
