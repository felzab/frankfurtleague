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

type FLSpieltagFieldGroup = "Zeitraum";

export type FLSpieltagDraftStatus = FLDraftStatus<FLSpieltagFieldGroup>;

type FLSpieltagFieldDescriptor = FLFieldDescriptor<FLSpieltagDraftFields, FLSpieltagFieldGroup>;

const readDatum = (value: string): string | null => (emptyAsNull(value) === null ? null : formatSpielDatum(value));

/**
 * Every field the matchday editor can change where it dates both ends. **`ende` carries the span
 * refinement's message**, which `FLPatchSpieltagPayloadSchema` puts there deliberately.
 */
const SPAN_DESCRIPTORS: readonly FLSpieltagFieldDescriptor[] = [
  { path: "beginn", label: "Beginn", group: "Zeitraum", read: (source) => readDatum(source.beginn) },
  { path: "ende", label: "Ende", group: "Zeitraum", read: (source) => readDatum(source.ende) },
];

/**
 * One row where one picker dates the matchday: a second would name a control that is not on screen.
 * `errorPaths` still lands the span refinement's message, which the schema reports on `ende`.
 */
const SINGLE_DAY_DESCRIPTORS: readonly FLSpieltagFieldDescriptor[] = [
  {
    path: "beginn",
    label: "Datum",
    group: "Zeitraum",
    errorPaths: ["beginn", "ende"],
    read: (source) => readDatum(source.beginn),
  },
];

export function deriveSpieltagDraftStatus({
  stored,
  draft,
  fieldErrors,
  isSingleDay,
}: {
  stored: FLSpieltagDraftFields;
  draft: FLSpieltagDraftFields;
  fieldErrors: FieldErrors;
  /** Which arrangement the Zeitraum panel is rendering, which is the form's decision and not this table's. */
  isSingleDay: boolean;
}): FLSpieltagDraftStatus {
  return deriveDraftStatus({ descriptors: isSingleDay ? SINGLE_DAY_DESCRIPTORS : SPAN_DESCRIPTORS, stored, draft, fieldErrors });
}
