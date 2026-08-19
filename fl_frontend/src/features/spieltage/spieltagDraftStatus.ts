/**
 * SPIELTAGE · what the matchday editor's draft has changed and got wrong
 *
 * One derivation over one matchday's draft, read by everything on the edit page that says something
 * about a field: label markers, change list, unsaved count, action bar, navigation guard. Pure,
 * so it is tested rather than clicked; `spielerDraftStatus.ts` is the pattern.
 *
 * Invariants:
 * - `path` is the payload's dotted path AND the input `name`, `FieldErrors` key and anchor id.
 * - Every editable field has a row in `FIELD_DESCRIPTORS`; a field with no row is invisible.
 * - There are exactly three rows, because a matchday stores nothing else a form may write: its
 *   position, its name and its expected match count are all derived.
 * - `inactive_since` is not a descriptor — retiring is a control, not a field.
 * - `saison_id` is not a descriptor — moving a matchday between seasons would strand its fixtures,
 *   so the patch payload does not carry one.
 */

import { PHASE_LABELS } from "@/features/saisons/constants";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLSaisonPhase } from "@/features/saisons/schemas";
import type { FieldErrors } from "@/shared/utils/validation";

/**
 * The fields the matchday editor owns, widened to what a draft holds mid-edit: `saison_phase` may be
 * null while a picker is untouched, which the schema turns into a field error rather than a type one.
 */
export type FLSpieltagDraftFields = {
  beginn: string;
  ende: string;
  saison_phase: FLSaisonPhase | null;
};

export type FLSpieltagFieldGroup = "Phase" | "Zeitraum";

export type FLSpieltagFieldStatus = {
  path: string;
  label: string;
  group: FLSpieltagFieldGroup;
  isChanged: boolean;
  error: string | null;
  storedText: string | null;
  draftText: string | null;
};

export type FLSpieltagDraftStatus = {
  fields: readonly FLSpieltagFieldStatus[];
  byPath: ReadonlyMap<string, FLSpieltagFieldStatus>;
  changed: readonly FLSpieltagFieldStatus[];
  invalid: readonly FLSpieltagFieldStatus[];
  isDirty: boolean;
};

type FieldDescriptor = {
  path: string;
  label: string;
  group: FLSpieltagFieldGroup;
  read: (source: FLSpieltagDraftFields) => string | null;
  /** Widened where a schema reports a field's failures under several keys. Defaults to `[path]`. */
  errorPaths?: readonly string[];
};

const emptyAsNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());

/**
 * Every field the matchday editor can change, in the order the change list reads them.
 *
 * Each `read` returns the DISPLAY text, which doubles as the comparison key. The two dates format to
 * the German calendar date the pickers show and the phase to its German label, so a change row reads
 * as what the admin picked rather than as `2026-04-11` or `viertelfinale`.
 *
 * **`ende` also carries the span refinement's message.** `FLPatchSpieltagPayloadSchema` puts the
 * "ends before it begins" error on `ende` deliberately — it is the field to fix — so editing `beginn`
 * alone still reports there, and nothing else claims that key.
 */
const FIELD_DESCRIPTORS: readonly FieldDescriptor[] = [
  {
    path: "saison_phase",
    label: "Phase",
    group: "Phase",
    read: (source) => (source.saison_phase === null ? null : PHASE_LABELS[source.saison_phase]),
  },
  {
    path: "beginn",
    label: "Beginn",
    group: "Zeitraum",
    read: (source) => (emptyAsNull(source.beginn) === null ? null : formatSpielDatum(source.beginn)),
  },
  {
    path: "ende",
    label: "Ende",
    group: "Zeitraum",
    read: (source) => (emptyAsNull(source.ende) === null ? null : formatSpielDatum(source.ende)),
  },
];

export function deriveSpieltagDraftStatus({
  stored,
  draft,
  fieldErrors,
}: {
  stored: FLSpieltagDraftFields;
  draft: FLSpieltagDraftFields;
  fieldErrors: FieldErrors;
}): FLSpieltagDraftStatus {
  const fields = FIELD_DESCRIPTORS.map((descriptor): FLSpieltagFieldStatus => {
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
