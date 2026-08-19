import { deriveDraftStatus } from "@/shared/utils/draftStatus";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLAddress } from "@/shared/schemas";
import type { FLDraftStatus, FLFieldDescriptor, FLFieldStatus } from "@/shared/utils/draftStatus";
import type { FieldErrors } from "@/shared/utils/validation";
import type { FLDisqualifikation, FLGruppenNames } from "./schemas";

/**
 * Widened to what a draft holds mid-edit: `gruppe` is null while the enter-a-season picker is
 * untouched, `membership` while the club is not in the selected season at all.
 */
export type FLTeamDraftFields = {
  name: string;
  shorthand: string;
  full_name: string;
  website_url: string;
  description: string;
  address: FLAddress;
  membership: {
    gruppe: FLGruppenNames | null;
    disqualifikation: FLDisqualifikation | null;
  } | null;
};

export type FLTeamFieldGroup = "Team" | "Adresse" | "Saison";

export type FLTeamFieldStatus = FLFieldStatus<FLTeamFieldGroup>;

export type FLTeamDraftStatus = FLDraftStatus<FLTeamFieldGroup>;

const emptyAsNull = (value: string): string | null => (value.trim() === "" ? null : value);

const FIELD_DESCRIPTORS: readonly FLFieldDescriptor<FLTeamDraftFields, FLTeamFieldGroup>[] = [
  { path: "name", label: "Name", group: "Team", read: (source) => emptyAsNull(source.name) },
  { path: "shorthand", label: "Kürzel", group: "Team", read: (source) => emptyAsNull(source.shorthand) },
  { path: "full_name", label: "Vollständiger Name", group: "Team", read: (source) => emptyAsNull(source.full_name) },
  { path: "website_url", label: "Website", group: "Team", read: (source) => emptyAsNull(source.website_url) },
  { path: "description", label: "Beschreibung", group: "Team", read: (source) => emptyAsNull(source.description) },
  { path: "address.strasse", label: "Straße", group: "Adresse", read: (source) => emptyAsNull(source.address.strasse) },
  { path: "address.hausnummer", label: "Hausnummer", group: "Adresse", read: (source) => emptyAsNull(source.address.hausnummer) },
  { path: "address.plz", label: "PLZ", group: "Adresse", read: (source) => emptyAsNull(source.address.plz) },
  { path: "address.stadtteil", label: "Stadtteil", group: "Adresse", read: (source) => emptyAsNull(source.address.stadtteil) },
  { path: "address.stadt", label: "Stadt", group: "Adresse", read: (source) => emptyAsNull(source.address.stadt) },
  {
    path: "gruppe",
    label: "Gruppe",
    group: "Saison",
    appliesTo: (source) => source.membership !== null,
    read: (source) => (source.membership?.gruppe ? `Gruppe ${source.membership.gruppe}` : null),
  },
  {
    path: "disqualifikation",
    label: "Disqualifikation",
    group: "Saison",
    appliesTo: (source) => source.membership !== null,
    read: (source) => {
      const record = source.membership?.disqualifikation ?? null;
      if (record === null) return null;
      // An empty grund still renders a row — the mid-edit state the schema rejects on save.
      return `${record.grund || "Kein Grund"} (ab ${formatSpielDatum(record.datum)})`;
    },
    errorPaths: ["disqualifikation", "disqualifikation.grund", "disqualifikation.datum"],
  },
];

export function deriveTeamDraftStatus({
  stored,
  draft,
  fieldErrors,
}: {
  stored: FLTeamDraftFields;
  draft: FLTeamDraftFields;
  fieldErrors: FieldErrors;
}): FLTeamDraftStatus {
  return deriveDraftStatus({ descriptors: FIELD_DESCRIPTORS, stored, draft, fieldErrors });
}
