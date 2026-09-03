import type { FLAustrittType, FLGruppenNames, FLKontaktEinwilligung, FLSchulform, FLTrainerZugleich, FLTrikotFarbe } from "./schemas";

export const TEAMS_CRUD_COPY = {
  searchLabel: "Teams suchen",
  searchPlaceholder: "z.B. Goethe-Gymnasium oder GG",
} as const;

export const KONTAKTE_CRUD_COPY = {
  searchLabel: "Kontakte suchen",
  searchPlaceholder: "z.B. Erika Mustermann oder eine E-Mail-Adresse",
  /** One per `fl_frontend/src/shared/components/ui/AdminCrudView.tsx :: CrudEmptiness` value: each narrowing stage asks something different of the reader. */
  emptyForQuery: "Keine Kontakte für diese Suche.",
  emptyForFilters: "Keine Kontakte für diese Filter.",
  emptyOverall: "Für diese Saison wurden noch keine Kontakte hinterlegt.",
} as const;

/** In the order every picker offers them. The closed set is `FLGruppenNames`'s. */
export const GRUPPEN_OPTIONS: readonly FLGruppenNames[] = ["A", "B", "C", "D"];

type AustrittOption = {
  readonly value: FLAustrittType;
  /** Names the RECORD, for the editor's picker and the change list. */
  readonly label: string;
  /** Names the CLUB's resulting state, for anything reading `… seit <Datum>`. */
  readonly zustand: string;
  /** The two-letter badge a table cell and the team popover have room for. */
  readonly kuerzel: string;
};

/**
 * The two routes out of a season, in the editor's order.
 *
 * All three wordings live here as one fact: a surface reads them rather than writing its own
 * German, so no two can name the same record differently — a withdrawal reading as a sanction.
 */
export const AUSTRITT_OPTIONS: readonly AustrittOption[] = [
  { value: "disqualifikation", label: "Disqualifikation", zustand: "Disqualifiziert", kuerzel: "DQ" },
  { value: "rueckzug", label: "Rückzug", zustand: "Zurückgezogen", kuerzel: "RZ" },
];

// The find cannot miss: `type` is the closed set the table enumerates, and the parse refuses
// anything else before a render sees it.
const austrittOption = (type: FLAustrittType): AustrittOption | undefined => AUSTRITT_OPTIONS.find((option) => option.value === type);

/** The state a club is in once the record exists — `Disqualifiziert seit …`, `Zurückgezogen seit …`. */
export function austrittZustand(type: FLAustrittType): string {
  return austrittOption(type)?.zustand ?? "";
}

/** The badge form. Always rendered beside the full `zustand` as a label, so the two letters never stand alone. */
export function austrittKuerzel(type: FLAustrittType): string {
  return austrittOption(type)?.kuerzel ?? "";
}

/**
 * The description's bound, mirrored from the backend models, which each spell it as a literal.
 * Every frontend enforcement point reads it from here, so no two can disagree about the cap.
 */
export const DESCRIPTION_MAX_LENGTH = 4096;

// The club-field ceilings, mirrored from `fl_backend/app/shared/schemas/bounds.py` and shared with
// the public application: both tiers refuse alike, so each number lives here once.
export const TEAM_NAME_MAX_LENGTH = 60;
export const TEAM_FULL_NAME_MAX_LENGTH = 120;
export const TEAM_WEBSITE_URL_MAX_LENGTH = 300;
// One part of one contact person's name, on the junction patch and the application both.
export const KONTAKT_NAME_MAX_LENGTH = 80;

type SchulformOption = {
  readonly value: FLSchulform;
  readonly label: string;
};

/**
 * The six school types, in the picker's order. The German is the school authority's own wording, so a
 * `G8` or a `G9` stays in the label rather than being spelled out.
 */
export const SCHULFORM_OPTIONS: readonly SchulformOption[] = [
  { value: "gymnasium_g8", label: "Gymnasium (G8)" },
  { value: "gymnasium_g9", label: "Gymnasium (G9)" },
  { value: "gesamtschule", label: "Gesamtschule" },
  { value: "privatschule_g8", label: "Privatschule (G8)" },
  { value: "privatschule_g9", label: "Privatschule (G9)" },
  { value: "oberstufengymnasium", label: "Oberstufengymnasium" },
];

export function schulformLabel(schulform: FLSchulform): string {
  return SCHULFORM_OPTIONS.find((option) => option.value === schulform)?.label ?? "";
}

export type TrikotFarbeOption = {
  readonly value: FLTrikotFarbe;
  readonly label: string;
  /** The swatch's fill, taken from the league's CI document and authoritative over any eyeballed match. */
  readonly hex: string;
};

/**
 * The league's sixteen CI colours, in the CI document's own order and with its own names. A surface
 * draws the swatch from `hex` rather than from a Tailwind token: the palette answers to the league's
 * print colours, which no theme scale tracks.
 */
export const TRIKOT_FARBE_OPTIONS: readonly TrikotFarbeOption[] = [
  { value: "weiss", label: "Weiß", hex: "#ffffff" },
  { value: "schwarz", label: "Schwarz", hex: "#111111" },
  { value: "rot", label: "Rot", hex: "#e52521" },
  { value: "braun", label: "Braun", hex: "#7a4a28" },
  { value: "orange", label: "Orange", hex: "#f47b20" },
  { value: "gelb", label: "Gelb", hex: "#f2c230" },
  { value: "hellgruen", label: "Hellgrün", hex: "#8fc752" },
  { value: "gruen", label: "Grün", hex: "#16a05d" },
  { value: "tuerkis", label: "Türkis", hex: "#00a6a6" },
  { value: "hellblau", label: "Hellblau", hex: "#19a7d8" },
  { value: "blau", label: "Blau", hex: "#2455c3" },
  { value: "dunkelblau", label: "Dunkelblau", hex: "#142b63" },
  { value: "violett", label: "Violett", hex: "#7138b5" },
  { value: "magenta", label: "Magenta", hex: "#c72c91" },
  { value: "bordeaux", label: "Bordeaux", hex: "#8e2430" },
  { value: "grau", label: "Grau", hex: "#8a9199" },
];

const trikotFarbeOption = (farbe: FLTrikotFarbe): TrikotFarbeOption | undefined => TRIKOT_FARBE_OPTIONS.find((o) => o.value === farbe);

export function trikotFarbeLabel(farbe: FLTrikotFarbe): string {
  return trikotFarbeOption(farbe)?.label ?? "";
}

/** The swatch's fill. Falls through to `transparent` so an unknown slug draws no colour at all rather than a wrong one. */
export function trikotFarbeHex(farbe: FLTrikotFarbe): string {
  return trikotFarbeOption(farbe)?.hex ?? "transparent";
}

/**
 * The agreement wording's version cap, mirrored from `fl_backend/app/shared/schemas/bounds.py`. Every
 * frontend enforcement point reads it from here, so the schema and the input cannot disagree.
 */
export const EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH = 64;

/**
 * The one scope a contact person's agreement covers. A single member because a second scope would be a
 * second agreement, gathered on its own terms.
 */
export const EINWILLIGUNG_UMFANG = "kontaktdaten" as const;

type EinwilligungHerkunftOption = {
  readonly value: FLKontaktEinwilligung["erteilt_von"];
  readonly label: string;
};

/**
 * How the agreement reached the league, in the editor's order. **Neither label may name a giver other
 * than the person**: the second is a transcription, and a label naming the school would record the
 * school as having consented for somebody.
 */
export const EINWILLIGUNG_HERKUNFT_OPTIONS: readonly EinwilligungHerkunftOption[] = [
  { value: "person", label: "Von der Person selbst" },
  { value: "administrativ", label: "Von der Verwaltung übertragen" },
];

/** What every surface renders for a stored agreement. */
export function einwilligungHerkunftLabel(herkunft: FLKontaktEinwilligung["erteilt_von"]): string {
  return EINWILLIGUNG_HERKUNFT_OPTIONS.find((option) => option.value === herkunft)?.label ?? "";
}

/**
 * The scheme every stored website URL carries, rendered as the field's uneditable prefix rather than
 * typed (`WebsiteUrlField`). So every box's `maxLength` is the payload ceiling minus this length: the
 * admin cannot spend on a prefix the form supplies.
 */
export const WEBSITE_URL_SCHEME = "https://";

/**
 * The three seats a season holds per club, in both surfaces' order.
 *
 * TWO wordings, as `AUSTRITT_OPTIONS` carries three: the admin takes the short form, the public one
 * the long form. Both live here, so no two surfaces name a seat differently.
 */
export const KONTAKT_ROLLEN = [
  { value: "trainer", label: "Trainer", langform: "Trainerin oder Trainer" },
  { value: "ansprechperson", label: "Ansprechperson", langform: "Ansprechperson" },
  { value: "stellvertretung", label: "Stellvertretung", langform: "Stellvertretung" },
] as const;

export type KontaktRolle = (typeof KONTAKT_ROLLEN)[number]["value"];

type TrainerZugleichOption = {
  /** A picker's key is a string; `null` is the answer „Eine eigene Person“ spells on the wire. */
  readonly key: string;
  readonly value: FLTrainerZugleich | null;
  readonly label: string;
};

/**
 * Which seat the Trainer IS, read after `TRAINER_ZUGLEICH_FRAGE`: that seat's details are what the
 * Trainer's boxes read.
 *
 * One closed set, never two ticks: a person cannot hold both of the other seats.
 */
export const TRAINER_ZUGLEICH_OPTIONS: readonly TrainerZugleichOption[] = [
  { key: "niemand", value: null, label: "Eine eigene Person" },
  { key: "ansprechperson", value: "ansprechperson", label: "Die Ansprechperson" },
  { key: "stellvertretung", value: "stellvertretung", label: "Die Stellvertretung" },
];

/** The question the three answer, spelled once so the picker and the draft rail cannot ask it differently. */
export const TRAINER_ZUGLEICH_FRAGE = "Die Trainerin oder der Trainer ist";

/** What every surface renders for a stored claim, the null answer included. */
export function trainerZugleichLabel(seat: FLTrainerZugleich | null): string {
  return TRAINER_ZUGLEICH_OPTIONS.find((option) => option.value === seat)?.label ?? "";
}
