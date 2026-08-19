import { PHASE_LABELS } from "@/features/saisons/constants";
import { deriveDraftStatus } from "@/shared/utils/draftStatus";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLSaisonPhase } from "@/features/saisons/schemas";
import type { FLDraftStatus, FLFieldDescriptor, FLFieldStatus } from "@/shared/utils/draftStatus";
import type { FieldErrors } from "@/shared/utils/validation";

/** Widened to what a draft holds mid-edit: `saison_phase` may be null while a picker is untouched. */
export type FLSpieltagDraftFields = {
  beginn: string;
  ende: string;
  saison_phase: FLSaisonPhase | null;
};

export type FLSpieltagFieldGroup = "Phase" | "Zeitraum";

export type FLSpieltagFieldStatus = FLFieldStatus<FLSpieltagFieldGroup>;

export type FLSpieltagDraftStatus = FLDraftStatus<FLSpieltagFieldGroup>;

const emptyAsNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());

/**
 * Every field the matchday editor can change. **`ende` carries the span refinement's message**, which
 * `FLPatchSpieltagPayloadSchema` puts there deliberately.
 */
const FIELD_DESCRIPTORS: readonly FLFieldDescriptor<FLSpieltagDraftFields, FLSpieltagFieldGroup>[] = [
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
  return deriveDraftStatus({ descriptors: FIELD_DESCRIPTORS, stored, draft, fieldErrors });
}
