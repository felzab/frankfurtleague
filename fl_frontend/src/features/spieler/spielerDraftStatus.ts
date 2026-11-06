import { deriveDraftStatus, emptyAsNull } from "@/shared/utils/draftStatus";
import { formatSpielDatum } from "@/shared/utils/format";

import { KADER_ABSCHNITT, rolleLabel } from "./constants";

import type { FLSpielerPosition, FLSpielerRolle, FLSpielerStufe } from "@/core/generated/client/types";
import type { FLDraftStatus, FLFieldDescriptor } from "@/shared/utils/draftStatus";
import type { FieldErrors } from "@/shared/utils/validation";

/**
 * Widened to what a draft holds mid-edit: `membership` is null while the player is in no squad for
 * the selected season at all.
 */
export type FLSpielerDraftFields = {
  first_name: string;
  last_name: string;
  birth_date: string | null;
  membership: {
    nummer: string;
    position: FLSpielerPosition | null;
    stufe: FLSpielerStufe | null;
    rolle: FLSpielerRolle | null;
  } | null;
};

type FLSpielerFieldGroup = "Person" | typeof KADER_ABSCHNITT;

export type FLSpielerDraftStatus = FLDraftStatus<FLSpielerFieldGroup>;

const FIELD_DESCRIPTORS = [
  { path: "first_name", label: "Vorname", group: "Person", read: (source) => emptyAsNull(source.first_name) },
  { path: "last_name", label: "Nachname", group: "Person", read: (source) => emptyAsNull(source.last_name) },
  {
    path: "birth_date",
    label: "Geburtsdatum",
    group: "Person",
    // Formatted, as every sibling rail is: the `DatePicker` beside this row shows the German day,
    // and a change row quoting the stored ISO string is one nobody can check against the control.
    read: (source) => (source.birth_date === null ? null : formatSpielDatum(source.birth_date)),
  },
] as const satisfies readonly FLFieldDescriptor<FLSpielerDraftFields, FLSpielerFieldGroup>[];

const SQUAD_DESCRIPTORS = [
  {
    path: "nummer",
    label: "Nummer",
    group: KADER_ABSCHNITT,
    appliesTo: (source) => source.membership !== null,
    read: (source) => emptyAsNull(source.membership?.nummer ?? ""),
  },
  {
    path: "position",
    label: "Position",
    group: KADER_ABSCHNITT,
    appliesTo: (source) => source.membership !== null,
    read: (source) => source.membership?.position ?? null,
  },
  {
    path: "stufe",
    label: "Stufe",
    group: KADER_ABSCHNITT,
    appliesTo: (source) => source.membership !== null,
    read: (source) => source.membership?.stufe ?? null,
  },
  {
    path: "rolle",
    label: "Rolle",
    group: KADER_ABSCHNITT,
    appliesTo: (source) => source.membership !== null,
    // `null` where no role is held, so giving one up renders as a REMOVAL in the change list. The
    // German comes from `ROLLE_OPTIONS`, which is what the control beside it reads.
    read: (source) => (source.membership?.rolle == null ? null : rolleLabel(source.membership.rolle)),
  },
] as const satisfies readonly FLFieldDescriptor<FLSpielerDraftFields, FLSpielerFieldGroup>[];

export type SpielerFieldPath = (typeof FIELD_DESCRIPTORS)[number]["path"] | (typeof SQUAD_DESCRIPTORS)[number]["path"];

export function deriveSpielerDraftStatus({
  stored,
  draft,
  fieldErrors,
}: {
  stored: FLSpielerDraftFields;
  draft: FLSpielerDraftFields;
  fieldErrors: FieldErrors;
}): FLSpielerDraftStatus {
  return deriveDraftStatus({ descriptors: [...FIELD_DESCRIPTORS, ...SQUAD_DESCRIPTORS], stored, draft, fieldErrors });
}
