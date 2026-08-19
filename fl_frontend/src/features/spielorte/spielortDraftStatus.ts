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
  // The payload's dotted path, and also the input `name`, the `FieldErrors` key and the anchor id, so
  // all four move together.
  path: string;
  label: string;
  group: FLSpielortFieldGroup;
  read: (source: FLSpielortDraftFields) => string | null;
};

const emptyAsNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());

/**
 * Every field the editor can change; one with no row here is invisible to the page. `read` returns
 * display text, which doubles as the comparison key. `maps_link` has no row — the backend derives it
 * and no payload carries it.
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
