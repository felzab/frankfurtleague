import { COPY } from "@/core/copy";
import { FLGruppenNames } from "@/core/generated/client/types";
import { KONTAKT_ROLLE_LONG_FORM, TRIKOT_FARBEN } from "@/core/teamVocabulary";
import { NICHT_HINTERLEGT, nichtHinterlegt } from "@/shared/utils/format";

import type { Copy } from "@/core/copy";
import type { FLAustrittType, FLKontaktKenntnisnahmeScope, FLSchulform, FLTrikotFarbe } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";

/** The closed set, in the order every picker offers it and a season's groups take their names. */
export const GRUPPEN_OPTIONS: readonly FLGruppenNames[] = Object.values(FLGruppenNames);

// Keyed by every route, so a route the contract adds fails to compile until the catalogue words it.
const AUSTRITT_WORDS: Record<FLAustrittType, { readonly state: Copy; readonly kuerzel: Copy }> = COPY.shared.austritt;

/** The state a club is in once the record exists — `Disqualifiziert seit …`, `Zurückgezogen seit …`. */
export function austrittZustand(type: FLAustrittType): Copy {
  return AUSTRITT_WORDS[type].state;
}

/** The badge form, for a table cell, a popover or a chip, where only two letters have room. */
function austrittKuerzel(type: FLAustrittType): Copy {
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
const SCHULFORM_OPTIONS: readonly SchulformOption[] = [
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

/** What an administrator's readout labels a seat's contact scope with, and its two values keyed by the scope. */
export const KONTAKT_WHATSAPP_FRAGE = "WhatsApp";
export const KONTAKT_WHATSAPP_LABELS: Readonly<Record<FLKontaktKenntnisnahmeScope, string>> = {
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
