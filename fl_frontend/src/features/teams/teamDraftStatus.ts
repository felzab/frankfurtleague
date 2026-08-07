/**
 * TEAMS · what the club editor's draft has changed and got wrong
 *
 * One derivation over one club's draft, read by everything on the edit page that says something about
 * a field: the label markers, the change list, the unsaved count, the action bar and the navigation
 * guard. Pure, so it is tested rather than clicked. The match editor's `draftStatus.ts` is the
 * pattern; this is the same idea over a simpler surface — a club has no action-required categories,
 * so there is no "expected" half.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • `path` is the field's dotted path in the payloads, and the SAME string is the input's `name`,
 *     the `FieldErrors` key and the anchor id. One string joins the label, the change row, the error
 *     and the jump link.
 *   • Every editable field has a row in `FIELD_DESCRIPTORS` and nothing reads a field any other way.
 *     A field with no row is invisible to the whole page.
 *   • The membership rows participate only while the club is IN the selected season — an absent
 *     junction row has no gruppe to change and no disqualification to lift.
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

/** The panel a field renders in — the change list's section heading. */
export type FLTeamFieldGroup = "Team" | "Adresse" | "Saison";

/** What the page knows about one editable field right now. */
export type FLTeamFieldStatus = {
  path: string;
  label: string;
  group: FLTeamFieldGroup;
  isChanged: boolean;
  /** The schema's message for this field, or `null`. */
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
      return `${record.grund || "—"} (ab ${formatSpielDatum(record.datum, "—")})`;
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
