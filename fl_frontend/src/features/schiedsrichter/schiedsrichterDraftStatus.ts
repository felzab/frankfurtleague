/**
 * SCHIEDSRICHTER · what the referee editor's draft has changed and got wrong
 *
 * One derivation over one referee's draft, read by everything on the edit page that says something
 * about a field: label markers, change list, unsaved count, action bar, navigation guard. Pure,
 * so it is tested rather than clicked; `spielerDraftStatus.ts` is the pattern.
 *
 * Invariants:
 * - `path` is the payload's dotted path AND the input `name`, `FieldErrors` key and anchor id.
 * - Every editable field has a row in `FIELD_DESCRIPTORS`; a field with no row is invisible.
 * - `inactive_since` is not a descriptor — retiring is a control, not a field.
 */

import { formatEuro } from "@/shared/utils/format";

import type { FLKontakt } from "@/shared/schemas";
import type { FieldErrors } from "@/shared/utils/validation";

/** The fields the referee editor owns, widened to what a draft holds mid-edit. */
export type FLSchiedsrichterDraftFields = {
  name: string;
  schule: string | null;
  kontakt: FLKontakt;
  default_payment: number;
};

export type FLSchiedsrichterFieldGroup = "Person" | "Kontakt" | "Honorar";

export type FLSchiedsrichterFieldStatus = {
  path: string;
  label: string;
  group: FLSchiedsrichterFieldGroup;
  isChanged: boolean;
  error: string | null;
  storedText: string | null;
  draftText: string | null;
};

export type FLSchiedsrichterDraftStatus = {
  fields: readonly FLSchiedsrichterFieldStatus[];
  byPath: ReadonlyMap<string, FLSchiedsrichterFieldStatus>;
  changed: readonly FLSchiedsrichterFieldStatus[];
  invalid: readonly FLSchiedsrichterFieldStatus[];
  isDirty: boolean;
};

type FieldDescriptor = {
  path: string;
  label: string;
  group: FLSchiedsrichterFieldGroup;
  read: (source: FLSchiedsrichterDraftFields) => string | null;
};

const emptyAsNull = (value: string | null): string | null => (value === null || value.trim() === "" ? null : value.trim());

/**
 * Every field the referee editor can change, in the order the change list reads them.
 *
 * Each `read` returns the DISPLAY text, which doubles as the comparison key — one function serves
 * `hasChanged`, `storedText` and `draftText`.
 *
 * `default_payment` formats to euros rather than reading as a bare integer: a change row saying
 * „25 → 30“ is a number without a unit, and the field it describes is a currency control.
 */
const FIELD_DESCRIPTORS: readonly FieldDescriptor[] = [
  { path: "name", label: "Name", group: "Person", read: (source) => emptyAsNull(source.name) },
  { path: "schule", label: "Schule / Verein", group: "Person", read: (source) => emptyAsNull(source.schule) },
  { path: "kontakt.email", label: "E-Mail", group: "Kontakt", read: (source) => emptyAsNull(source.kontakt.email) },
  { path: "kontakt.telefon", label: "Telefon", group: "Kontakt", read: (source) => emptyAsNull(source.kontakt.telefon) },
  { path: "default_payment", label: "Standard-Honorar", group: "Honorar", read: (source) => formatEuro(source.default_payment) },
];

export function deriveSchiedsrichterDraftStatus({
  stored,
  draft,
  fieldErrors,
}: {
  stored: FLSchiedsrichterDraftFields;
  draft: FLSchiedsrichterDraftFields;
  fieldErrors: FieldErrors;
}): FLSchiedsrichterDraftStatus {
  const fields = FIELD_DESCRIPTORS.map((descriptor): FLSchiedsrichterFieldStatus => {
    const storedText = descriptor.read(stored);
    const draftText = descriptor.read(draft);

    return {
      path: descriptor.path,
      label: descriptor.label,
      group: descriptor.group,
      isChanged: storedText !== draftText,
      error: fieldErrors[descriptor.path] ?? null,
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
