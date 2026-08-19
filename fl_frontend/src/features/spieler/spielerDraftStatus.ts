import type { FieldErrors } from "@/shared/utils/validation";
import type { FLSpielerPosition, FLSpielerStufe } from "./schemas";
import type { SpielerTeamOption } from "./types";

/**
 * Widened to what a draft holds mid-edit: `team_id` is null while the enter-a-season picker is
 * untouched, `membership` while the player is in no squad for the selected season at all.
 */
export type FLSpielerDraftFields = {
  vorname: string;
  nachname: string;
  membership: {
    team_id: string | null;
    nummer: string;
    position: FLSpielerPosition | null;
    stufe: FLSpielerStufe | null;
    is_nachgetragen: boolean;
    is_captain: boolean;
  } | null;
};

export type FLSpielerFieldGroup = "Person" | "Kader";

export type FLSpielerFieldStatus = {
  path: string;
  label: string;
  group: FLSpielerFieldGroup;
  isChanged: boolean;
  error: string | null;
  storedText: string | null;
  draftText: string | null;
};

export type FLSpielerDraftStatus = {
  fields: readonly FLSpielerFieldStatus[];
  byPath: ReadonlyMap<string, FLSpielerFieldStatus>;
  changed: readonly FLSpielerFieldStatus[];
  invalid: readonly FLSpielerFieldStatus[];
  isDirty: boolean;
};

type FieldDescriptor = {
  /** The payloads' dotted path AND the input `name`, `FieldErrors` key and anchor id. */
  path: string;
  label: string;
  group: FLSpielerFieldGroup;
  read: (source: FLSpielerDraftFields) => string | null;
  /** Restricts the row to drafts where it exists — the squad rows. Defaults to always. */
  appliesTo?: (source: FLSpielerDraftFields) => boolean;
  /** Widened where a schema reports a field's failures under several keys. Defaults to `[path]`. */
  errorPaths?: readonly string[];
};

const emptyAsNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());

/**
 * `read` returns DISPLAY text that doubles as the comparison key: every field formats to a string
 * that changes exactly when the value does.
 *
 * A field with no row here is invisible to the whole edit page.
 */
const FIELD_DESCRIPTORS: readonly FieldDescriptor[] = [
  { path: "vorname", label: "Vorname", group: "Person", read: (source) => emptyAsNull(source.vorname) },
  { path: "nachname", label: "Nachname", group: "Person", read: (source) => emptyAsNull(source.nachname) },
];

/** Built per call: `team_id` needs the season's team list, since a change row showing an id is one nobody can check. */
function squadDescriptors(teams: readonly SpielerTeamOption[]): readonly FieldDescriptor[] {
  const nameById = new Map(teams.map((team) => [team.teamId, team.name]));

  return [
    {
      path: "team_id",
      label: "Team",
      group: "Kader",
      appliesTo: (source) => source.membership !== null,
      // An unknown id renders as itself rather than as null: the player is in a team the selected
      // season does not offer, which is a real state worth seeing rather than an empty change row.
      read: (source) => {
        const teamId = source.membership?.team_id ?? null;
        return teamId === null ? null : (nameById.get(teamId) ?? teamId);
      },
    },
    {
      path: "nummer",
      label: "Nummer",
      group: "Kader",
      appliesTo: (source) => source.membership !== null,
      read: (source) => emptyAsNull(source.membership?.nummer ?? ""),
    },
    {
      path: "position",
      label: "Position",
      group: "Kader",
      appliesTo: (source) => source.membership !== null,
      read: (source) => source.membership?.position ?? null,
    },
    {
      path: "stufe",
      label: "Stufe",
      group: "Kader",
      appliesTo: (source) => source.membership !== null,
      read: (source) => source.membership?.stufe ?? null,
    },
    {
      path: "is_captain",
      label: "Kapitän",
      group: "Kader",
      appliesTo: (source) => source.membership !== null,
      // `null` when the flag is off, so losing the captaincy renders as a REMOVAL in the change list
      // rather than as "true → false".
      read: (source) => (source.membership?.is_captain ? "Ja" : null),
    },
  ];
}

export function deriveSpielerDraftStatus({
  stored,
  draft,
  fieldErrors,
  teams,
}: {
  stored: FLSpielerDraftFields;
  draft: FLSpielerDraftFields;
  fieldErrors: FieldErrors;
  /** The selected season's teams, for resolving `team_id` to the name the picker showed. */
  teams: readonly SpielerTeamOption[];
}): FLSpielerDraftStatus {
  const descriptors = [...FIELD_DESCRIPTORS, ...squadDescriptors(teams)];

  const fields = descriptors
    .filter((descriptor) => descriptor.appliesTo?.(draft) ?? true)
    .map((descriptor): FLSpielerFieldStatus => {
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
