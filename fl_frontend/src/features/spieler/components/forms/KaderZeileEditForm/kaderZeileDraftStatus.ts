import { rolleLabel } from "@/features/spieler/constants";
import { deriveDraftStatus, emptyAsNull } from "@/shared/utils/draftStatus";

import type { FLSpielerPosition, FLSpielerRolle, FLSpielerStufe } from "@/features/spieler/schemas";
import type { FLDraftStatus, FLFieldDescriptor } from "@/shared/utils/draftStatus";
import type { FieldErrors } from "@/shared/utils/validation";

/** The four fields a seat holder edits on one squad row, the number as the box holds it. */
export type FLKaderZeileDraftFields = {
  nummer: string;
  position: FLSpielerPosition | null;
  stufe: FLSpielerStufe | null;
  rolle: FLSpielerRolle | null;
};

type FLKaderZeileFieldGroup = "Kadereintrag";

export type FLKaderZeileDraftStatus = FLDraftStatus<FLKaderZeileFieldGroup>;

/** The club and the Nachnominierung have no row: the stored row keeps both, and no payload of this lane carries either. */
const FIELD_DESCRIPTORS = [
  { path: "nummer", label: "Nummer", group: "Kadereintrag", read: (source) => emptyAsNull(source.nummer) },
  { path: "position", label: "Position", group: "Kadereintrag", read: (source) => source.position },
  { path: "stufe", label: "Stufe", group: "Kadereintrag", read: (source) => source.stufe },
  // `null` where no role is held, so giving one up reads as a removal in the change list.
  { path: "rolle", label: "Rolle", group: "Kadereintrag", read: (source) => (source.rolle === null ? null : rolleLabel(source.rolle)) },
] as const satisfies readonly FLFieldDescriptor<FLKaderZeileDraftFields, FLKaderZeileFieldGroup>[];

export type KaderZeileFieldPath = (typeof FIELD_DESCRIPTORS)[number]["path"];

export function deriveKaderZeileDraftStatus({
  stored,
  draft,
  fieldErrors,
}: {
  stored: FLKaderZeileDraftFields;
  draft: FLKaderZeileDraftFields;
  fieldErrors: FieldErrors;
}): FLKaderZeileDraftStatus {
  return deriveDraftStatus({ descriptors: FIELD_DESCRIPTORS, stored, draft, fieldErrors });
}
