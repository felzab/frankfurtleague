/**
 * TEAMS · what the club editor's draft has changed and got wrong
 *
 * One derivation over one club's draft, read by everything on the edit page that says something
 * about a field: label markers, change list, unsaved count, action bar, navigation guard. Pure,
 * so it is tested rather than clicked; the match editor's `draftStatus.ts` is the pattern, minus
 * the "expected" half — a club has no action-required categories.
 *
 * Invariants:
 * - `path` is the payloads' dotted path AND the input `name`, `FieldErrors` key and anchor id.
 * - Every editable field has a row in `FIELD_DESCRIPTORS`; a field with no row is invisible.
 * - Membership rows participate only while the club is IN the selected season.
 */

import { formatSpielDatum } from "@/shared/utils/format";

import type { FLAddress } from "@/shared/schemas";
import type { FieldErrors } from "@/shared/utils/validation";
import type { FLDisqualifikation, FLGruppenNames } from "./schemas";

/**
 * The fields the club editor owns, widened to what a draft holds mid-edit: `gruppe` may be null
 * while the enter-a-season picker is untouched, and `membership` is null while the club is not in
 * the selected season at all.
 */
export type FLTeamDraftFields = {
  name: string;
  shorthand: string;
  full_name: string;
  website_url: string;
  description: string;
  address: FLAddress;
  membership: {
    gruppe: FLGruppenNames | null;
    disqualifikation: FLDisqualifikation | null;
  } | null;
};

export type FLTeamFieldGroup = "Team" | "Adresse" | "Saison";

export type FLTeamFieldStatus = {
  path: string;
  label: string;
  group: FLTeamFieldGroup;
  isChanged: boolean;
  error: string | null;
  storedText: string | null;
  draftText: string | null;
};

export type FLTeamDraftStatus = {
  fields: readonly FLTeamFieldStatus[];
  byPath: ReadonlyMap<string, FLTeamFieldStatus>;
  changed: readonly FLTeamFieldStatus[];
  invalid: readonly FLTeamFieldStatus[];
  isDirty: boolean;
};

type FieldDescriptor = {
  path: string;
  label: string;
  group: FLTeamFieldGroup;
  read: (source: FLTeamDraftFields) => string | null;
  /** Restricts the row to drafts where it exists — the two membership rows. Defaults to always. */
  appliesTo?: (source: FLTeamDraftFields) => boolean;
  /** Widened where a schema reports a field's failures under several keys. Defaults to `[path]`. */
  errorPaths?: readonly string[];
};

const emptyAsNull = (value: string): string | null => (value.trim() === "" ? null : value);

/**
 * Every field the club editor can change, in the order the change list reads them.
 *
 * Each `read` returns the DISPLAY text, which doubles as the comparison key: every club field is a
 * string, and the two membership fields format to strings that change exactly when the value does —
 * so one function serves `hasChanged`, `storedText` and `draftText`, where the match editor needed
 * three.
 */
const FIELD_DESCRIPTORS: readonly FieldDescriptor[] = [
  { path: "name", label: "Name", group: "Team", read: (source) => emptyAsNull(source.name) },
  { path: "shorthand", label: "Kürzel", group: "Team", read: (source) => emptyAsNull(source.shorthand) },
  { path: "full_name", label: "Vollständiger Name", group: "Team", read: (source) => emptyAsNull(source.full_name) },
  { path: "website_url", label: "Website", group: "Team", read: (source) => emptyAsNull(source.website_url) },
  { path: "description", label: "Beschreibung", group: "Team", read: (source) => emptyAsNull(source.description) },
  { path: "address.strasse", label: "Straße", group: "Adresse", read: (source) => emptyAsNull(source.address.strasse) },
  { path: "address.hausnummer", label: "Hausnummer", group: "Adresse", read: (source) => emptyAsNull(source.address.hausnummer) },
  { path: "address.plz", label: "PLZ", group: "Adresse", read: (source) => emptyAsNull(source.address.plz) },
  { path: "address.stadtteil", label: "Stadtteil", group: "Adresse", read: (source) => emptyAsNull(source.address.stadtteil) },
  { path: "address.stadt", label: "Stadt", group: "Adresse", read: (source) => emptyAsNull(source.address.stadt) },
  {
    path: "gruppe",
    label: "Gruppe",
    group: "Saison",
    appliesTo: (source) => source.membership !== null,
    read: (source) => (source.membership?.gruppe ? `Gruppe ${source.membership.gruppe}` : null),
  },
  {
    path: "disqualifikation",
    label: "Disqualifikation",
    group: "Saison",
    appliesTo: (source) => source.membership !== null,
    read: (source) => {
      const record = source.membership?.disqualifikation ?? null;
      if (record === null) return null;
      // The date through the app's one date formatter, so the change row reads like every card.
      // An empty grund still renders a row — the mid-edit state the schema rejects on save.
      return `${record.grund || "Kein Grund"} (ab ${formatSpielDatum(record.datum)})`;
    },
    errorPaths: ["disqualifikation", "disqualifikation.grund", "disqualifikation.datum"],
  },
];

export function deriveTeamDraftStatus({
  stored,
  draft,
  fieldErrors,
}: {
  stored: FLTeamDraftFields;
  draft: FLTeamDraftFields;
  fieldErrors: FieldErrors;
}): FLTeamDraftStatus {
  const fields = FIELD_DESCRIPTORS.filter((descriptor) => descriptor.appliesTo?.(draft) ?? true).map((descriptor): FLTeamFieldStatus => {
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
