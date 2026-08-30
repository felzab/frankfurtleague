import { deriveDraftStatus, emptyAsNull } from "@/shared/utils/draftStatus";
import { formatEuro } from "@/shared/utils/format";

import type { FLAddress } from "@/shared/schemas";
import type { FLDraftStatus, FLFieldDescriptor } from "@/shared/utils/draftStatus";
import type { FieldErrors } from "@/shared/utils/validation";

/** The fields the venue editor owns, widened to what a draft holds mid-edit. */
export type FLSpielortDraftFields = {
  name: string;
  address: FLAddress;
  default_mietpreis: number | null;
};

export type FLSpielortFieldGroup = "Spielort" | "Adresse" | "Miete";

export type FLSpielortDraftStatus = FLDraftStatus<FLSpielortFieldGroup>;

/** `maps_link` has no row: the backend derives it and no payload carries it. */
const FIELD_DESCRIPTORS: readonly FLFieldDescriptor<FLSpielortDraftFields, FLSpielortFieldGroup>[] = [
  { path: "name", label: "Name", group: "Spielort", read: (source) => emptyAsNull(source.name) },
  { path: "address.strasse", label: "Straße", group: "Adresse", read: (source) => emptyAsNull(source.address.strasse) },
  { path: "address.hausnummer", label: "Hausnummer", group: "Adresse", read: (source) => emptyAsNull(source.address.hausnummer) },
  { path: "address.plz", label: "PLZ", group: "Adresse", read: (source) => emptyAsNull(source.address.plz) },
  { path: "address.stadt", label: "Stadt", group: "Adresse", read: (source) => emptyAsNull(source.address.stadt) },
  { path: "address.stadtteil", label: "Stadtteil", group: "Adresse", read: (source) => emptyAsNull(source.address.stadtteil) },
  {
    path: "default_mietpreis",
    label: "Standard-Mietpreis",
    group: "Miete",
    read: (source) => (source.default_mietpreis === null ? null : formatEuro(source.default_mietpreis)),
  },
];

export function deriveSpielortDraftStatus({
  stored,
  draft,
  fieldErrors,
}: {
  stored: FLSpielortDraftFields;
  draft: FLSpielortDraftFields;
  fieldErrors: FieldErrors;
}): FLSpielortDraftStatus {
  return deriveDraftStatus({ descriptors: FIELD_DESCRIPTORS, stored, draft, fieldErrors });
}
