/**
 * SPIELER · what the squad editor's draft has changed and got wrong
 *
 * One derivation over one player's draft, read by everything on the edit page that says something
 * about a field: label markers, change list, unsaved count, action bar, navigation guard. Pure,
 * so it is tested rather than clicked; `teamDraftStatus.ts` is the pattern.
 *
 * Invariants:
 * - `path` is the payloads' dotted path AND the input `name`, `FieldErrors` key and anchor id.
 * - Every editable field has a row in `FIELD_DESCRIPTORS`; a field with no row is invisible.
 * - Squad rows participate only while the player IS in a squad that season.
 * - `inactive_since` is not a descriptor — retiring is a control, not a field.
 * - `is_nachgetragen` renders as a note (decided 2026-08-07) yet travels — the patch is wholesale.
 */

import type { FieldErrors } from "@/shared/utils/validation";
import type { FLSpielerPosition, FLSpielerStufe } from "./schemas";
import type { SpielerTeamOption } from "./types";

/**
 * The fields the squad editor owns, widened to what a draft holds mid-edit: `team_id` may be null
 * while the enter-a-season picker is untouched, and `membership` is null while the player is in no
 * squad for the selected season at all.
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

/** The panel a field renders in — the change list's section heading. */
export type FLSpielerFieldGroup = "Person" | "Kader";

/** What the page knows about one editable field right now. */
export type FLSpielerFieldStatus = {
  path: string;
  label: string;
  group: FLSpielerFieldGroup;
  isChanged: boolean;
  /** The schema's message for this field, or `null`. */
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
 * Every field the squad editor can change, in the order the change list reads them.
 *
 * Each `read` returns the DISPLAY text, which doubles as the comparison key: every field here either
 * is a string or formats to one that changes exactly when the value does — so one function serves
 * `hasChanged`, `storedText` and `draftText`.
 *
 * `team_id` is the exception and is why `deriveSpielerDraftStatus` takes the team list: an id is not
 * display text, and a change row reading `68f0…c1` instead of the club's name would be the one row
 * on the page nobody can check. The lookup resolves it to the name the picker showed.
 */
const FIELD_DESCRIPTORS: readonly FieldDescriptor[] = [
  { path: "vorname", label: "Vorname", group: "Person", read: (source) => emptyAsNull(source.vorname) },
  { path: "nachname", label: "Nachname", group: "Person", read: (source) => emptyAsNull(source.nachname) },
];

/** Built per call, because the two team-dependent rows need the season's team list to read an id. */
function squadDescriptors(teams: readonly SpielerTeamOption[]): readonly FieldDescriptor[] {
  const nameById = new Map(teams.map((team) => [team.teamId, team.name]));

  return [
    {
      path: "team_id",
      label: "Team",
      group: "Kader",
      appliesTo: (source) => source.membership !== null,
      // The name, never the id. An unknown id still renders as itself rather than as null: it means
      // the player is in a team the selected season does not offer, which is a real state worth
      // seeing rather than an empty change row.
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
      // Read as the words the switch shows, so the change row says what moved rather than
      // "true → false". `null` when the flag is off, which makes losing the captaincy render as a
      // REMOVAL in the change list — which is what it is.
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
