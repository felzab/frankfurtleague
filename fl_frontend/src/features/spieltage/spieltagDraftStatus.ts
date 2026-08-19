import { PHASE_LABELS } from "@/features/saisons/constants";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLSaisonPhase } from "@/features/saisons/schemas";
import type { FieldErrors } from "@/shared/utils/validation";

/** Widened to what a draft holds mid-edit: `saison_phase` may be null while a picker is untouched. */
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
  /** Dotted payload path; also the input's `name`, the `FieldErrors` key and the anchor id. */
  path: string;
  label: string;
  group: FLSpieltagFieldGroup;
  read: (source: FLSpieltagDraftFields) => string | null;
  /** Widened where a schema reports a field's failures under several keys. Defaults to `[path]`. */
  errorPaths?: readonly string[];
};

const emptyAsNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());

/**
 * Every field the matchday editor can change. Each `read` returns DISPLAY text, which doubles as the
 * comparison key. **`ende` carries the span refinement's message**, which
 * `FLPatchSpieltagPayloadSchema` puts there deliberately.
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
