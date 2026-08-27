import { deriveDraftStatus, emptyAsNull } from "@/shared/utils/draftStatus";
import { formatSpielDatum } from "@/shared/utils/format";

import { AUSTRITT_OPTIONS, einwilligungHerkunftLabel, schulformLabel, trikotFarbeLabel } from "./constants";

import type { FLAddress } from "@/shared/schemas";
import type { FLDraftStatus, FLFieldDescriptor } from "@/shared/utils/draftStatus";
import type { FieldErrors } from "@/shared/utils/validation";
import type { KontaktRolle } from "./constants";
import type { FLGruppenNames, FLSchulform, FLTrikotFarbe } from "./schemas";
import type { AustrittDraft, KontaktpersonDraft, SaisonTeamKontakteDraft } from "./types";

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
  schulform: FLSchulform | null;
  membership: {
    gruppe: FLGruppenNames | null;
    austritt: AustrittDraft | null;
    trikot_farbe: FLTrikotFarbe | null;
    kontakte: SaisonTeamKontakteDraft | null;
  } | null;
};

export type FLTeamFieldGroup = "Team" | "Adresse" | "Saison" | "Kontakte";

export type FLTeamDraftStatus = FLDraftStatus<FLTeamFieldGroup>;

/**
 * Every junction row is graded on the membership alone. Keying one on the value it reports would drop
 * it from the fold exactly when that value turns null, which is the deletion the list has to show.
 */
const inSaison = (source: FLTeamDraftFields) => source.membership !== null;

/**
 * One seat's two readers, split because they answer different questions: who this is, and on whose
 * word their details are held. Both fallbacks render rather than hide, as `austritt`'s do.
 */
const seatOf =
  (rolle: KontaktRolle) =>
  (source: FLTeamDraftFields): KontaktpersonDraft | null =>
    source.membership?.kontakte?.[rolle] ?? null;

const readPerson = (rolle: KontaktRolle) => (source: FLTeamDraftFields) => {
  const person = seatOf(rolle)(source);
  if (person === null) return null;
  const name = `${person.vorname} ${person.nachname}`.trim();

  return [
    name === "" ? "Ohne Namen" : name,
    emptyAsNull(person.email) ?? "Keine E-Mail",
    emptyAsNull(person.telefon) ?? "Keine Telefonnummer",
    person.geburtsdatum === "" ? "Kein Geburtsdatum" : `geboren am ${formatSpielDatum(person.geburtsdatum)}`,
  ].join(", ");
};

const readEinwilligung = (rolle: KontaktRolle) => (source: FLTeamDraftFields) => {
  const record = seatOf(rolle)(source)?.einwilligung ?? null;
  if (record === null) return null;
  const herkunft = record.erteilt_von === null ? "Herkunft offen" : einwilligungHerkunftLabel(record.erteilt_von);
  const fassung = record.text_version === "" ? "ohne Fassung" : `Fassung ${record.text_version}`;
  const datum = record.datum === "" ? "ohne Datum" : `ab ${formatSpielDatum(record.datum)}`;

  return `${herkunft}, ${fassung} (${datum})`;
};

/** A seat's fields report under their own keys, so the row has to look for all of them. */
const personErrorPaths = (path: string): string[] => [
  path,
  `${path}.vorname`,
  `${path}.nachname`,
  `${path}.email`,
  `${path}.telefon`,
  `${path}.geburtsdatum`,
];

const einwilligungErrorPaths = (path: string): string[] => [path, `${path}.erteilt_von`, `${path}.text_version`, `${path}.datum`];

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
  // Each path is spelled here rather than composed from the seat's key: `fieldLabelPaths.test.ts`
  // reads a literal, and a composed one would leave the Geändert marker silently unwired.
  {
    path: "kontakte.trainer",
    label: "Trainer",
    group: "Kontakte",
    appliesTo: inSaison,
    read: readPerson("trainer"),
    errorPaths: personErrorPaths("kontakte.trainer"),
  },
  {
    path: "kontakte.trainer.einwilligung",
    label: "Trainer: Einwilligung",
    group: "Kontakte",
    appliesTo: inSaison,
    read: readEinwilligung("trainer"),
    errorPaths: einwilligungErrorPaths("kontakte.trainer.einwilligung"),
  },
  {
    path: "kontakte.ansprechperson",
    label: "Ansprechperson",
    group: "Kontakte",
    appliesTo: inSaison,
    read: readPerson("ansprechperson"),
    errorPaths: personErrorPaths("kontakte.ansprechperson"),
  },
  {
    path: "kontakte.ansprechperson.einwilligung",
    label: "Ansprechperson: Einwilligung",
    group: "Kontakte",
    appliesTo: inSaison,
    read: readEinwilligung("ansprechperson"),
    errorPaths: einwilligungErrorPaths("kontakte.ansprechperson.einwilligung"),
  },
  {
    path: "kontakte.stellvertretung",
    label: "Stellvertretung",
    group: "Kontakte",
    appliesTo: inSaison,
    read: readPerson("stellvertretung"),
    errorPaths: personErrorPaths("kontakte.stellvertretung"),
  },
  {
    path: "kontakte.stellvertretung.einwilligung",
    label: "Stellvertretung: Einwilligung",
    group: "Kontakte",
    appliesTo: inSaison,
    read: readEinwilligung("stellvertretung"),
    errorPaths: einwilligungErrorPaths("kontakte.stellvertretung.einwilligung"),
  },
  {
    path: "kontakte.trainer_ist_ansprechperson",
    // Its own row, because the flag can move while the three people stand: turning it off leaves the
    // Ansprechperson holding what it copied, and nothing else on the panel would have changed.
    label: "Trainer ist Ansprechperson",
    group: "Kontakte",
    appliesTo: inSaison,
    read: (source) => {
      const kontakte = source.membership?.kontakte ?? null;
      return kontakte === null ? null : kontakte.trainer_ist_ansprechperson ? "Ja" : "Nein";
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
