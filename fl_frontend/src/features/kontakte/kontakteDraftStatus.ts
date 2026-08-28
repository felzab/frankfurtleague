import { einwilligungHerkunftLabel } from "@/features/teams/constants";
import { deriveDraftStatus, emptyAsNull } from "@/shared/utils/draftStatus";
import { formatSpielDatum } from "@/shared/utils/format";

import type { KontaktRolle } from "@/features/teams/constants";
import type { KontaktpersonDraft, SaisonTeamKontakteDraft } from "@/features/teams/types";
import type { FLDraftStatus, FLFieldDescriptor } from "@/shared/utils/draftStatus";
import type { FieldErrors } from "@/shared/utils/validation";

/** The block mid-edit, `null` while the club records nobody for the season at all. */
export type FLKontakteDraftFields = {
  kontakte: SaisonTeamKontakteDraft | null;
};

/** One section per seat, plus the block's own row for the flag that spans two of them. */
export type FLKontakteFieldGroup = "Trainer" | "Ansprechperson" | "Stellvertretung" | "Kontakte";

export type FLKontakteDraftStatus = FLDraftStatus<FLKontakteFieldGroup>;

/**
 * One seat's two readers, split because they answer different questions: who this is, and on whose
 * word their details are held. Both fallbacks render rather than hide, so a half-filled seat shows
 * up in the change list as what is still missing.
 */
const seatOf =
  (rolle: KontaktRolle) =>
  (source: FLKontakteDraftFields): KontaktpersonDraft | null =>
    source.kontakte?.[rolle] ?? null;

const readPerson = (rolle: KontaktRolle) => (source: FLKontakteDraftFields) => {
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

const readEinwilligung = (rolle: KontaktRolle) => (source: FLKontakteDraftFields) => {
  const record = seatOf(rolle)(source)?.einwilligung ?? null;
  if (record === null) return null;
  const herkunft = record.erteilt_von === null ? "Noch offen" : einwilligungHerkunftLabel(record.erteilt_von);
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

/**
 * Every path one seat's failures land under. Exported because the editor re-judges exactly this set
 * when a seat goes empty, and two hand-kept lists would drift into a verdict nothing ever clears.
 */
export const kontaktSeatPaths = (rolle: KontaktRolle): readonly string[] => [
  ...personErrorPaths(`kontakte.${rolle}`),
  ...einwilligungErrorPaths(`kontakte.${rolle}.einwilligung`),
];

// Each path is spelled here rather than composed from the seat's key: `fieldLabelPaths.test.ts`
// reads a literal, and a composed one would leave the Geändert marker silently unwired.
const FIELD_DESCRIPTORS: readonly FLFieldDescriptor<FLKontakteDraftFields, FLKontakteFieldGroup>[] = [
  {
    path: "kontakte.trainer",
    // The seat names the section, so the row inside it says which half of the seat moved.
    label: "Person",
    group: "Trainer",
    read: readPerson("trainer"),
    errorPaths: personErrorPaths("kontakte.trainer"),
  },
  {
    path: "kontakte.trainer.einwilligung",
    label: "Einwilligung",
    group: "Trainer",
    read: readEinwilligung("trainer"),
    errorPaths: einwilligungErrorPaths("kontakte.trainer.einwilligung"),
  },
  {
    path: "kontakte.ansprechperson",
    label: "Person",
    group: "Ansprechperson",
    read: readPerson("ansprechperson"),
    errorPaths: personErrorPaths("kontakte.ansprechperson"),
  },
  {
    path: "kontakte.ansprechperson.einwilligung",
    label: "Einwilligung",
    group: "Ansprechperson",
    read: readEinwilligung("ansprechperson"),
    errorPaths: einwilligungErrorPaths("kontakte.ansprechperson.einwilligung"),
  },
  {
    path: "kontakte.stellvertretung",
    label: "Person",
    group: "Stellvertretung",
    read: readPerson("stellvertretung"),
    errorPaths: personErrorPaths("kontakte.stellvertretung"),
  },
  {
    path: "kontakte.stellvertretung.einwilligung",
    label: "Einwilligung",
    group: "Stellvertretung",
    read: readEinwilligung("stellvertretung"),
    errorPaths: einwilligungErrorPaths("kontakte.stellvertretung.einwilligung"),
  },
  {
    path: "kontakte.trainer_ist_ansprechperson",
    // Its own row, because the flag can move while the three people stand: turning it off leaves the
    // Ansprechperson holding what it copied, and nothing else on the panel would have changed.
    label: "Trainer ist Ansprechperson",
    group: "Kontakte",
    read: (source) => {
      const kontakte = source.kontakte;
      return kontakte === null ? null : kontakte.trainer_ist_ansprechperson ? "Ja" : "Nein";
    },
  },
];

export function deriveKontakteDraftStatus({
  stored,
  draft,
  fieldErrors,
}: {
  stored: FLKontakteDraftFields;
  draft: FLKontakteDraftFields;
  fieldErrors: FieldErrors;
}): FLKontakteDraftStatus {
  return deriveDraftStatus({ descriptors: FIELD_DESCRIPTORS, stored, draft, fieldErrors });
}
