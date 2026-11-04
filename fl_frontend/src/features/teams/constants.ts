import { COPY } from "@/core/copy";
import { FLGruppenNames } from "@/core/generated/client/types";
import { KONTAKT_ROLLE_LONG_FORM, TRIKOT_FARBEN } from "@/core/teamVocabulary";
import { NICHT_HINTERLEGT, nichtHinterlegt } from "@/shared/utils/format";

import type { Copy } from "@/core/copy";
import type {
  FLAustrittType,
  FLKontaktEnteredBy,
  FLKontaktKenntnisnahmeUmfang,
  FLSchulform,
  FLTrainerAlso,
  FLTrikotFarbe,
} from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";

export const TEAMS_CRUD_COPY = {
  searchLabel: "Teams suchen",
  searchPlaceholder: "z.B. Goethe-Gymnasium oder GG",
  /** The create trigger's words, which the route's loading placeholder also lays out, so its box is the trigger's own. */
  createLabel: "Neues Team anlegen",
  /** One per `fl_frontend/src/shared/components/ui/AdminCrudView.tsx :: CrudEmptiness` value: each narrowing stage asks something different of the reader. */
  emptyForQuery: "Keine Teams für diese Suche.",
  emptyForFilters: "Keine Teams für diese Filter.",
  emptyOverall: "Es wurden noch keine Teams angelegt.",
} as const;

/**
 * What retiring a club leaves standing, in the retirement dialog. Here rather than at the dialog, so
 * the sentence a reader is asked to act on sits beside the club's other copy and is read once.
 */
export const TEAM_RETIREMENT_CONSEQUENCE =
  "Seine Spiele, Saisons und Tabellen bleiben erhalten, und sein Kürzel bleibt reserviert. Das Team steht nur nicht mehr zur Auswahl.";

/** Why the list's row and the editor's header both close the retirement `retire_blocked` would refuse, in one sentence. */
export const TEAM_NICHT_STILLLEGBAR = "Stilllegen ist nur möglich, wenn das Team in keiner laufenden oder geplanten Saison spielt.";

export const KONTAKTE_CRUD_COPY = {
  searchLabel: "Kontakte suchen",
  searchPlaceholder: "z.B. Erika Mustermann oder eine E-Mail-Adresse",
  /** One per `fl_frontend/src/shared/components/ui/AdminCrudView.tsx :: CrudEmptiness` value: each narrowing stage asks something different of the reader. */
  emptyForQuery: "Keine Kontakte für diese Suche.",
  emptyForFilters: "Keine Kontakte für diese Filter.",
  emptyOverall: "Für diese Saison wurden noch keine Kontakte hinterlegt.",
} as const;

/** The club editor's season panel, named by its heading where a sentence sends the reader to it, so a renamed panel takes the sentence with it. */
export const SAISON_ABSCHNITT = "Saison";

/** The club editor's contacts panel, named by its heading where a refusal sends the reader to it, so a renamed panel takes the refusal with it. */
export const KONTAKTE_ABSCHNITT = "Kontakte";

/** The closed set, in the order every picker offers it and a season's groups take their names. */
export const GRUPPEN_OPTIONS: readonly FLGruppenNames[] = Object.values(FLGruppenNames);

type AustrittOption = {
  readonly value: FLAustrittType;
  /** Names the RECORD, for the editor's picker and the change list. */
  readonly label: Copy;
  /** Names the CLUB's resulting state, for anything reading `… seit <Datum>`. */
  readonly zustand: Copy;
  /** The two-letter badge a table cell and the team popover have room for. */
  readonly kuerzel: Copy;
};

// Keyed by every route, so a route the contract adds fails to compile until the catalogue words it.
const AUSTRITT_WORDS: Record<FLAustrittType, Omit<AustrittOption, "value">> = COPY.shared.austritt;

/**
 * The two routes out of a season, in the editor's order.
 *
 * All three wordings are one fact, spelled once in the catalogue: a surface reads them here rather than
 * writing its own German, so no two can name the same record differently — a withdrawal reading as a sanction.
 */
export const AUSTRITT_OPTIONS: readonly AustrittOption[] = [
  { value: "disqualifikation", ...AUSTRITT_WORDS.disqualifikation },
  { value: "rueckzug", ...AUSTRITT_WORDS.rueckzug },
];

/** The state a club is in once the record exists — `Disqualifiziert seit …`, `Zurückgezogen seit …`. */
export function austrittZustand(type: FLAustrittType): Copy {
  return AUSTRITT_WORDS[type].zustand;
}

/** The badge form, for a table cell, a popover or a chip, where only two letters have room. */
export function austrittKuerzel(type: FLAustrittType): Copy {
  return AUSTRITT_WORDS[type].kuerzel;
}

// A disqualification is the league's sanction, so its chip takes the danger hue; a withdrawal is the club's own act.
const AUSTRITT_TONE = { disqualifikation: "danger", rueckzug: "neutral" } as const satisfies Record<FLAustrittType, ChipProps["tone"]>;

/**
 * A club's exit chip, after its name wherever a list or its page names it: the route's two letters, which a screen
 * reader hears as the club's state, so every surface draws one chip for one record.
 */
export function austrittChip(type: FLAustrittType): ChipProps {
  return { tone: AUSTRITT_TONE[type], label: austrittKuerzel(type), spoken: austrittZustand(type) };
}

/**
 * The description's bound, mirrored from `fl_backend/app/shared/schemas/bounds.py`. Every frontend
 * enforcement point reads it from here, so no two can disagree about the cap.
 */
export const DESCRIPTION_MAX_LENGTH = 4096;

// The club-field ceilings, mirrored from `fl_backend/app/shared/schemas/bounds.py` and shared with
// the public application: both tiers refuse alike, so each number lives here once.
export const TEAM_NAME_MAX_LENGTH = 60;
export const TEAM_FULL_NAME_MAX_LENGTH = 120;
export const TEAM_WEBSITE_URL_MAX_LENGTH = 300;
// A person's name, or one part of one, at every field the backend types with
// `fl_backend/app/shared/schemas/kontakt.py :: CustomKontaktName`.
export const KONTAKT_NAME_MAX_LENGTH = 80;
// The one refusal of that ceiling, for every form that holds a name to it.
export const KONTAKT_NAME_ZU_LANG = `Der Name darf höchstens ${String(KONTAKT_NAME_MAX_LENGTH)} Zeichen lang sein.`;

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

export type TrikotFarbeOption = (typeof TRIKOT_FARBEN)[number];

/**
 * The league's kit palette, which the mail builders state to a school too: `fl_frontend/src/core/teamVocabulary.ts ::
 * TRIKOT_FARBEN` holds it. A swatch draws from `hex`, never a Tailwind token: the colour sheet's hex codes are
 * authoritative, and no theme scale tracks them.
 */
export const TRIKOT_FARBE_OPTIONS: readonly TrikotFarbeOption[] = TRIKOT_FARBEN;

const trikotFarbeOption = (farbe: FLTrikotFarbe): TrikotFarbeOption | undefined => TRIKOT_FARBE_OPTIONS.find((o) => o.value === farbe);

export function trikotFarbeLabel(farbe: FLTrikotFarbe): string {
  return trikotFarbeOption(farbe)?.label ?? "";
}

/** The swatch's fill. Falls through to `transparent` so an unknown slug draws no colour at all rather than a wrong one. */
export function trikotFarbeHex(farbe: FLTrikotFarbe): string {
  return trikotFarbeOption(farbe)?.hex ?? "transparent";
}

/**
 * The stamped wording's version cap, mirrored from `fl_backend/app/shared/schemas/bounds.py`. Every
 * frontend enforcement point reads it from here, so the schema and the input cannot disagree.
 */
export const EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH = 64;

/**
 * The one scope a contact person's Kenntnisnahme covers. A single member because a second scope would
 * be a second acknowledgement, gathered on its own terms.
 */
export const EINWILLIGUNG_UMFANG = "kontaktdaten" as const;

/**
 * Names WHO fills a contact's birthdate rather than reporting that nobody has: before the person confirms,
 * „Nicht hinterlegt“ would read as a field the administrator is expected to get round to.
 */
const TRAEGT_DIE_PERSON_EIN = "Trägt die Person selbst ein";

/**
 * A contact's empty birthdate, on every page: the person's own step until they confirm, a field held
 * empty after. `ohneLabel` where no label stands beside it, so the words name the field.
 */
export function kontaktGeburtsdatumLeer(bestaetigtAm: string | null, ohneLabel = false): string {
  if (bestaetigtAm === null) return ohneLabel ? "Geburtsdatum trägt die Person selbst ein" : TRAEGT_DIE_PERSON_EIN;

  return ohneLabel ? nichtHinterlegt("Geburtsdatum") : NICHT_HINTERLEGT;
}

type EingetragenVonOption = {
  readonly value: FLKontaktEnteredBy;
  readonly label: string;
};

// Keyed by every member, so a member the enum gains fails the type check here rather than rendering as nothing.
const EINGETRAGEN_VON_LABELS = {
  bewerbung: "Mit der Bewerbung eingetragen",
  liga: "Von der Liga eingetragen",
} as const satisfies Record<FLKontaktEnteredBy, string>;

/**
 * Who seated a contact person, in the order the contacts facet offers them: the applicant on the form,
 * or the league. The person's own answer is the confirmation stamp's to say, never this one's.
 */
export const EINGETRAGEN_VON_OPTIONS: readonly EingetragenVonOption[] = [
  { value: "bewerbung", label: EINGETRAGEN_VON_LABELS.bewerbung },
  { value: "liga", label: EINGETRAGEN_VON_LABELS.liga },
];

/** The Herkunft every surface renders for a contact seat: who seated the person. */
export function eingetragenVonLabel(von: FLKontaktEnteredBy): string {
  return EINGETRAGEN_VON_LABELS[von];
}

/**
 * The scheme every stored website URL carries, rendered as the field's uneditable prefix rather than
 * typed (`WebsiteUrlField`). So every box's `maxLength` is the payload ceiling minus this length: the
 * admin cannot spend on a prefix the form supplies.
 */
export const WEBSITE_URL_SCHEME = "https://";

/** What an administrator's readout labels a seat's contact scope with, and its two values keyed by the scope. */
export const KONTAKT_WHATSAPP_FRAGE = "WhatsApp";
export const KONTAKT_WHATSAPP_LABELS: Readonly<Record<FLKontaktKenntnisnahmeUmfang, string>> = {
  kontaktdaten_whatsapp: "erlaubt",
  kontaktdaten: "nicht erlaubt",
};

/**
 * The three seats a season holds per club, in both surfaces' order.
 *
 * TWO wordings, as `AUSTRITT_OPTIONS` carries three: the admin takes the short form, the public one
 * the long form, which `fl_frontend/src/core/teamVocabulary.ts :: KONTAKT_ROLLE_LONG_FORM` holds for the mails too. Both
 * are read from here, so no two surfaces name a seat differently.
 */
export const KONTAKT_ROLLEN = [
  // The Ansprechperson leads and the Trainer closes: the coach claim is answered on the Trainer's
  // own panel, and it names a seat the reader has already typed.
  { value: "ansprechperson", label: "Ansprechperson", langform: KONTAKT_ROLLE_LONG_FORM.ansprechperson },
  { value: "stellvertretung", label: "Stellvertretung", langform: KONTAKT_ROLLE_LONG_FORM.stellvertretung },
  { value: "trainer", label: "Trainer", langform: KONTAKT_ROLLE_LONG_FORM.trainer },
] as const;

export type KontaktRolle = (typeof KONTAKT_ROLLEN)[number]["value"];

type TrainerZugleichOption = {
  /** A picker's key is a string; `null` is the answer „Eine eigene Person“ spells on the wire. */
  readonly key: string;
  readonly value: FLTrainerAlso | null;
  readonly label: string;
};

/**
 * Which seat the Trainer IS, read after `TRAINER_ZUGLEICH_FRAGE`: that seat's details are what the
 * Trainer's boxes read.
 *
 * One closed set, never two ticks: a person cannot hold both of the other seats.
 */
export const TRAINER_ZUGLEICH_OPTIONS: readonly TrainerZugleichOption[] = [
  { key: "ansprechperson", value: "ansprechperson", label: "Die Ansprechperson" },
  { key: "stellvertretung", value: "stellvertretung", label: "Die Stellvertretung" },
  // Last, because it is the one answer that leaves the Trainer's boxes below the picker to be typed
  // into: a seat answer hides them on the public form and fills them read-only in the admin's editor.
  { key: "niemand", value: null, label: "Eine andere Person" },
];

/** The question the three answer, spelled once so the picker and the draft rail cannot ask it differently. */
export const TRAINER_ZUGLEICH_FRAGE = "Die Trainerin oder der Trainer ist";

/** What every surface renders for a stored claim, the null answer included. */
export function trainerZugleichLabel(seat: FLTrainerAlso | null): string {
  return TRAINER_ZUGLEICH_OPTIONS.find((option) => option.value === seat)?.label ?? "";
}
