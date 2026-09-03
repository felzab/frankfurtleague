import { deriveDraftStatus, emptyAsNull } from "@/shared/utils/draftStatus";
import { formatSpielDatum } from "@/shared/utils/format";

import { AUSTRITT_OPTIONS, schulformLabel, trikotFarbeLabel } from "./constants";

import type { FLAddress } from "@/shared/schemas";
import type { FLDraftStatus, FLFieldDescriptor } from "@/shared/utils/draftStatus";
import type { FieldErrors } from "@/shared/utils/validation";
import type { FLGruppenNames, FLSchulform, FLTrikotFarbe } from "./schemas";
import type { AustrittDraft } from "./types";

/**
 * Widened to what a draft holds mid-edit: `gruppe` is null while the enter-a-season picker is
 * untouched, `membership` while the club is not in the selected season at all.
 */
export type FLTeamDraftFields = {
  name: string;
  shorthand: string;
  full_name: string;
  // Nullable as the payload is: `null` is a club with no website, which `emptyAsNull` already grades
  // as unset below.
  website_url: string | null;
  description: string;
  address: FLAddress;
  schulform: FLSchulform | null;
  membership: {
    gruppe: FLGruppenNames | null;
    austritt: AustrittDraft | null;
    trikot_farbe: FLTrikotFarbe | null;
  } | null;
};

type FLTeamFieldGroup = "Team" | "Adresse" | "Saison";

export type FLTeamDraftStatus = FLDraftStatus<FLTeamFieldGroup>;

/**
 * Every junction row is graded on the membership alone. Keying one on the value it reports would drop
 * it from the fold exactly when that value turns null, which is the deletion the list has to show.
 */
const inSaison = (source: FLTeamDraftFields) => source.membership !== null;

const FIELD_DESCRIPTORS: readonly FLFieldDescriptor<FLTeamDraftFields, FLTeamFieldGroup>[] = [
  { path: "name", label: "Name", group: "Team", read: (source) => emptyAsNull(source.name) },
  { path: "shorthand", label: "Kürzel", group: "Team", read: (source) => emptyAsNull(source.shorthand) },
  { path: "full_name", label: "Vollständiger Name", group: "Team", read: (source) => emptyAsNull(source.full_name) },
  { path: "website_url", label: "Website", group: "Team", read: (source) => emptyAsNull(source.website_url) },
  { path: "description", label: "Beschreibung", group: "Team", read: (source) => emptyAsNull(source.description) },
  {
    path: "schulform",
    label: "Schulform",
    group: "Team",
    read: (source) => (source.schulform === null ? null : schulformLabel(source.schulform)),
  },
  { path: "address.strasse", label: "Straße", group: "Adresse", read: (source) => emptyAsNull(source.address.strasse) },
  { path: "address.hausnummer", label: "Hausnummer", group: "Adresse", read: (source) => emptyAsNull(source.address.hausnummer) },
  { path: "address.plz", label: "PLZ", group: "Adresse", read: (source) => emptyAsNull(source.address.plz) },
  { path: "address.stadtteil", label: "Stadtteil", group: "Adresse", read: (source) => emptyAsNull(source.address.stadtteil) },
  { path: "address.stadt", label: "Stadt", group: "Adresse", read: (source) => emptyAsNull(source.address.stadt) },
  {
    path: "gruppe",
    label: "Gruppe",
    group: "Saison",
    appliesTo: inSaison,
    read: (source) => (source.membership?.gruppe ? `Gruppe ${source.membership.gruppe}` : null),
  },
  {
    path: "austritt",
    label: "Austritt",
    group: "Saison",
    appliesTo: inSaison,
    read: (source) => {
      const record = source.membership?.austritt ?? null;
      if (record === null) return null;
      // The route is IN the rendered value: switching a stored Disqualifikation to a Rückzug changes
      // nothing else, and a line that ignored it would leave the save button disabled on a real edit.
      const art = AUSTRITT_OPTIONS.find((option) => option.value === record.type)?.label ?? "Art offen";
      // Both fallbacks render a row rather than hiding one: they are the mid-edit states the schema
      // rejects on save, and the change list is where the admin sees what is still missing.
      return `${art}: ${record.grund || "Kein Grund"} (ab ${formatSpielDatum(record.datum)})`;
    },
    errorPaths: ["austritt", "austritt.type", "austritt.grund", "austritt.datum"],
  },
  {
    path: "trikot_farbe",
    label: "Trikotfarbe",
    group: "Saison",
    appliesTo: inSaison,
    read: (source) => {
      const farbe = source.membership?.trikot_farbe ?? null;
      return farbe === null ? null : trikotFarbeLabel(farbe);
    },
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
