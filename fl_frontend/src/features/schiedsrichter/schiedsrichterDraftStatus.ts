import { deriveDraftStatus, emptyAsNull } from "@/shared/utils/draftStatus";
import { formatEuro } from "@/shared/utils/format";

import type { FLKontakt } from "@/shared/schemas";
import type { FLDraftStatus, FLFieldDescriptor } from "@/shared/utils/draftStatus";
import type { FieldErrors } from "@/shared/utils/validation";

/** The fields the referee editor owns, widened to what a draft holds mid-edit. */
export type FLSchiedsrichterDraftFields = {
  name: string;
  schule: string | null;
  kontakt: FLKontakt;
  default_payment: number | null;
};

export type FLSchiedsrichterFieldGroup = "Person" | "Kontakt" | "Honorar";

export type FLSchiedsrichterDraftStatus = FLDraftStatus<FLSchiedsrichterFieldGroup>;

/** `default_payment` formats to euros, so a change row reads as money rather than as a bare number. */
const FIELD_DESCRIPTORS: readonly FLFieldDescriptor<FLSchiedsrichterDraftFields, FLSchiedsrichterFieldGroup>[] = [
  { path: "name", label: "Name", group: "Person", read: (source) => emptyAsNull(source.name) },
  { path: "schule", label: "Schule / Verein", group: "Person", read: (source) => emptyAsNull(source.schule) },
  { path: "kontakt.email", label: "E-Mail", group: "Kontakt", read: (source) => emptyAsNull(source.kontakt.email) },
  { path: "kontakt.telefon", label: "Telefon", group: "Kontakt", read: (source) => emptyAsNull(source.kontakt.telefon) },
  {
    path: "default_payment",
    label: "Standard-Honorar",
    group: "Honorar",
    read: (source) => (source.default_payment === null ? null : formatEuro(source.default_payment)),
  },
];

export function deriveSchiedsrichterDraftStatus({
  stored,
  draft,
  fieldErrors,
}: {
  stored: FLSchiedsrichterDraftFields;
  draft: FLSchiedsrichterDraftFields;
  fieldErrors: FieldErrors;
}): FLSchiedsrichterDraftStatus {
  return deriveDraftStatus({ descriptors: FIELD_DESCRIPTORS, stored, draft, fieldErrors });
}
