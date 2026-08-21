import { deriveDraftStatus, emptyAsNull } from "@/shared/utils/draftStatus";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLDraftStatus, FLFieldDescriptor } from "@/shared/utils/draftStatus";
import type { FieldErrors } from "@/shared/utils/validation";

/**
 * The draft's own shape, where the read model's `null` is `""`: a cleared picker and an undated
 * matchday are one state to the change list, and `emptyAsNull` reads both as a removal.
 */
export type FLSpieltagDraftFields = {
  beginn: string;
  ende: string;
};

export type FLSpieltagFieldGroup = "Zeitraum";

export type FLSpieltagDraftStatus = FLDraftStatus<FLSpieltagFieldGroup>;

/**
 * Every field the matchday editor can change. **`ende` carries the span refinement's message**, which
 * `FLPatchSpieltagPayloadSchema` puts there deliberately.
 */
const FIELD_DESCRIPTORS: readonly FLFieldDescriptor<FLSpieltagDraftFields, FLSpieltagFieldGroup>[] = [
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
