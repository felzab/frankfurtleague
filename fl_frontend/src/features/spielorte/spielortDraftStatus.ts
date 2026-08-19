/**
 * SPIELORTE · what the venue editor's draft has changed and got wrong
 *
 * One derivation over one venue's draft, read by everything on the edit page that says something
 * about a field: label markers, change list, unsaved count, action bar, navigation guard. Pure,
 * so it is tested rather than clicked; `spielerDraftStatus.ts` is the pattern.
 *
 * Invariants:
 * - `path` is the payload's dotted path AND the input `name`, `FieldErrors` key and anchor id.
 * - Every editable field has a row in `FIELD_DESCRIPTORS`; a field with no row is invisible.
 * - `maps_link` is not a descriptor — the backend derives it from the name and address, so there is
 *   no field for it to be a row of.
 * - `inactive_since` is not a descriptor — retiring is a control, not a field.
 */

import { formatEuro } from "@/shared/utils/format";

import type { FLAddress } from "@/shared/schemas";
import type { FieldErrors } from "@/shared/utils/validation";

/** The fields the venue editor owns, widened to what a draft holds mid-edit. */
export type FLSpielortDraftFields = {
  name: string;
  address: FLAddress;
  default_mietpreis: number;
};

export type FLSpielortFieldGroup = "Spielort" | "Adresse" | "Miete";

export type FLSpielortFieldStatus = {
  path: string;
  label: string;
  group: FLSpielortFieldGroup;
  isChanged: boolean;
  error: string | null;
  storedText: string | null;
  draftText: string | null;
};

export type FLSpielortDraftStatus = {
  fields: readonly FLSpielortFieldStatus[];
  byPath: ReadonlyMap<string, FLSpielortFieldStatus>;
  changed: readonly FLSpielortFieldStatus[];
  invalid: readonly FLSpielortFieldStatus[];
  isDirty: boolean;
};

type FieldDescriptor = {
  path: string;
  label: string;
  group: FLSpielortFieldGroup;
  read: (source: FLSpielortDraftFields) => string | null;
};

const emptyAsNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());

/**
 * Every field the venue editor can change, in the order the change list reads them.
 *
 * Each `read` returns the DISPLAY text, which doubles as the comparison key — one function serves
 * `hasChanged`, `storedText` and `draftText`.
 *
 * The address is five rows rather than one, because each is a separate control with its own error
 * key: a single "Adresse geändert" row would mark four untouched fields alongside the one that moved.
 */
const FIELD_DESCRIPTORS: readonly FieldDescriptor[] = [
  { path: "name", label: "Name", group: "Spielort", read: (source) => emptyAsNull(source.name) },
  { path: "address.strasse", label: "Straße", group: "Adresse", read: (source) => emptyAsNull(source.address.strasse) },
  { path: "address.hausnummer", label: "Hausnummer", group: "Adresse", read: (source) => emptyAsNull(source.address.hausnummer) },
  { path: "address.plz", label: "PLZ", group: "Adresse", read: (source) => emptyAsNull(source.address.plz) },
  { path: "address.stadt", label: "Stadt", group: "Adresse", read: (source) => emptyAsNull(source.address.stadt) },
  { path: "address.stadtteil", label: "Stadtteil", group: "Adresse", read: (source) => emptyAsNull(source.address.stadtteil) },
  { path: "default_mietpreis", label: "Standard-Mietpreis", group: "Miete", read: (source) => formatEuro(source.default_mietpreis) },
];

export function deriveSpielortDraftStatus({
  stored,
  draft,
  fieldErrors,
}: {
  stored: FLSpielortDraftFields;
  draft: FLSpielortDraftFields;
  fieldErrors: FieldErrors;
}): FLSpielortDraftStatus {
  const fields = FIELD_DESCRIPTORS.map((descriptor): FLSpielortFieldStatus => {
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
