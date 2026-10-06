import { gekeyteFassung } from "@/core/einwilligungSeiten";
import { ABSATZ_CLASSES, Gefuellt } from "@/features/bewerbungen/components/ui/Gefuellt";
import { rollenLangform } from "@/features/bewerbungen/constants";
import { formatSpielDatum } from "@/shared/utils/format";

import type { GekeyteFassung } from "@/core/einwilligungSeiten";
import type { FLEinwilligungFassung } from "@/core/schemas";
import type { FLKontaktRolle } from "@/features/bewerbungen/schemas";
import type { Slots } from "@/shared/utils/stampedSlots";
import type { EinwilligungWorte, PersonUmfang, SitzUmfang } from "./EinwilligungForm";

// Each list is its page's whole set, as `fl_frontend/src/core/einwilligungSeiten.ts` keeps the
// confirmation pages': a served map missing a key or holding one more is refused, never rendered with a gap.

// A `nurWiderruf…` key is shown beside the one record its cause holds, never on the others.
const SPIELER_ABSATZ_SCHLUESSEL = ["veroeffentlichung", "medien", "widerruf", "nurWiderrufNichtAktiv", "nurWiderrufBisAufnahme"] as const;
const SCHIEDSRICHTER_ABSATZ_SCHLUESSEL = ["veroeffentlichung", "medien", "widerruf", "nurWiderrufNichtAktiv"] as const;
const SITZ_ABSATZ_SCHLUESSEL = ["whatsapp", "medien", "widerruf", "nurWiderrufVorbei", "nurWiderrufBisZusage"] as const;
const UMFANG_SCHLUESSEL = ["kader_oeffentlich", "intern"] as const;
// The seat's one switch-shaped scope, keyed by the value it writes when on.
const SITZ_UMFANG_SCHLUESSEL = ["kontaktdaten_whatsapp"] as const;

/** The person's own values a sentence names, set apart as the confirmation pages set them. */
const EIGENE = new Set(["team", "saison"]);

const absatz = (text: string, werte: Slots) => (
  <Gefuellt
    text={text}
    werte={werte}
    eigene={EIGENE}
  />
);

/** The media floor a record's entry serves, which every paragraph naming it fills. */
type MedienBoden = { readonly medien_mindestalter: number };

/** A pupil's or a referee's control words from that kind's keyed wording, with the one reason its record takes a withdrawal alone. */
function personWorte(
  gekeyt: GekeyteFassung<"veroeffentlichung" | "medien" | "widerruf", (typeof UMFANG_SCHLUESSEL)[number]>,
  frage: string,
  eintrag: MedienBoden,
  nurWiderruf: string | undefined,
): EinwilligungWorte<PersonUmfang> {
  const werte: Slots = { medienMinAlter: String(eintrag.medien_mindestalter) };
  const { absaetze } = gekeyt;

  return {
    textVersion: gekeyt.textVersion,
    umfang: { frage: frage, optionen: gekeyt.bedienelemente, absatz: absatz(absaetze.veroeffentlichung, werte) },
    medien: { schalter: gekeyt.schalter, absatz: absatz(absaetze.medien, werte) },
    ...(nurWiderruf === undefined ? {} : { nurWiderruf: nurWiderruf }),
    widerruf: absatz(absaetze.widerruf, werte),
  };
}

/** Why a pupil's record takes a withdrawal alone: retired, or a registration its team has not decided. */
export type SpielerGrund = "nichtAktiv" | "bisAufnahme";

/**
 * The control's words for a pupil's record or pending registration, from the account page's running
 * wording for pupils. `frage` is the kind's own question, which the registry does not stamp.
 */
export function spielerWorte(
  fassung: FLEinwilligungFassung,
  frage: string,
  eintrag: MedienBoden,
  grund?: SpielerGrund,
): EinwilligungWorte<PersonUmfang> {
  const gekeyt = gekeyteFassung(fassung, SPIELER_ABSATZ_SCHLUESSEL, UMFANG_SCHLUESSEL);
  const nurWiderruf =
    grund === undefined ? undefined : grund === "nichtAktiv" ? gekeyt.absaetze.nurWiderrufNichtAktiv : gekeyt.absaetze.nurWiderrufBisAufnahme;

  return personWorte(gekeyt, frage, eintrag, nurWiderruf);
}

/** The control's words for a referee's record; a retired one's carries the reason it takes a withdrawal alone. */
export function schiedsrichterWorte(
  fassung: FLEinwilligungFassung,
  frage: string,
  eintrag: MedienBoden,
  nichtAktiv: boolean,
): EinwilligungWorte<PersonUmfang> {
  const gekeyt = gekeyteFassung(fassung, SCHIEDSRICHTER_ABSATZ_SCHLUESSEL, UMFANG_SCHLUESSEL);

  return personWorte(gekeyt, frage, eintrag, nichtAktiv ? gekeyt.absaetze.nurWiderrufNichtAktiv : undefined);
}

/** Why a seat takes a withdrawal alone: a past season's or a withdrawn team's, or a pending application's. */
export type SitzGrund = "vorbei" | "bisZusage";

/** The control's words for one team season's contact seats: WhatsApp beside the media choice, each a switch. */
export function sitzWorte(
  fassung: FLEinwilligungFassung,
  sitz: MedienBoden & { readonly team_name: string; readonly saison_id: string },
  grund?: SitzGrund,
): EinwilligungWorte<SitzUmfang> {
  const gekeyt = gekeyteFassung(fassung, SITZ_ABSATZ_SCHLUESSEL, SITZ_UMFANG_SCHLUESSEL);
  const werte: Slots = { medienMinAlter: String(sitz.medien_mindestalter), team: sitz.team_name, saison: sitz.saison_id };
  const nurWiderruf =
    grund === undefined ? undefined : grund === "vorbei" ? gekeyt.absaetze.nurWiderrufVorbei : gekeyt.absaetze.nurWiderrufBisZusage;

  return {
    textVersion: gekeyt.textVersion,
    whatsapp: {
      schalter: gekeyt.bedienelemente.kontaktdaten_whatsapp,
      an: "kontaktdaten_whatsapp",
      aus: "kontaktdaten",
      absatz: absatz(gekeyt.absaetze.whatsapp, werte),
    },
    medien: { schalter: gekeyt.schalter, absatz: absatz(gekeyt.absaetze.medien, werte) },
    ...(nurWiderruf === undefined ? {} : { nurWiderruf: nurWiderruf }),
    widerruf: absatz(gekeyt.absaetze.widerruf, werte),
  };
}

/** Filled by `Gefuellt` itself on every page, so no record has to carry it. */
const SELBST_GEFUELLT = new Set(["datenschutz"]);

/** A record's fills as served, `null` where the record holds nothing to fill that slot with. */
export type Fuellung = Readonly<Record<string, string | null>>;

/**
 * The words a person confirmed, filled from the record's present context, or `null` where a slot is
 * served empty; throws for a slot nothing maps (`docs/frontend/spec.md :: I895`, `:: I896`).
 */
export function bestaetigteWorte(fassung: FLEinwilligungFassung, fuellung: Fuellung) {
  const offen = fassung.platzhalter.filter((slot) => !SELBST_GEFUELLT.has(slot) && !Object.hasOwn(fuellung, slot));
  if (offen.length > 0) throw new Error(`the confirmed wording ${fassung.text_version} has no value for ${offen.join(", ")}`);

  // A sentence with its subject blanked misstates what was agreed as surely as a literal slot does.
  if (fassung.platzhalter.some((slot) => fuellung[slot] === null)) return null;
  const werte = fuellung as Slots;

  return (
    <>
      {fassung.absaetze.map((text) => (
        <p
          key={text}
          className={ABSATZ_CLASSES}>
          <Gefuellt
            text={text}
            werte={werte}
            eigene={EIGENE}
          />
        </p>
      ))}
    </>
  );
}

/** The pupil's record title; one record per address, so it names nothing further. */
export const SPIELER_TITEL = "Als Spielerin oder Spieler";

/** A referee's record title, named by the record: one address may hold several referee rows. */
export const schiedsrichterTitel = (schiedsrichter: { readonly name: string }): string =>
  `Als Schiedsrichterin oder Schiedsrichter: ${schiedsrichter.name}`;

/** A seat's record title, which names the team season the controls move; the switches' own words are the same on every seat. */
export const sitzTitel = (sitz: {
  readonly rollen: readonly FLKontaktRolle[];
  readonly team_name: string;
  readonly saison_id: string;
}): string => `Als ${rollenLangform(sitz.rollen)}: ${sitz.team_name}, Saison ${sitz.saison_id}`;

/** A pending application's record title, named apart from a season row's so the two never read as one. */
export const bewerbungTitel = (bewerbung: {
  readonly rollen: readonly FLKontaktRolle[];
  readonly schule: string;
  readonly saison_id: string;
}): string => `Als ${rollenLangform(bewerbung.rollen)}: Bewerbung für ${bewerbung.schule}, Saison ${bewerbung.saison_id}`;

/** What heads one confirmation's words on a seat's record: the roles it confirmed, and the day where stored. */
export const sitzBestaetigungZeile = (bestaetigung: {
  readonly rollen: readonly FLKontaktRolle[];
  readonly bestaetigt_am: string | null;
}): string =>
  bestaetigung.bestaetigt_am === null
    ? `Als ${rollenLangform(bestaetigung.rollen)}`
    : `Als ${rollenLangform(bestaetigung.rollen)}, bestätigt am ${formatSpielDatum(bestaetigung.bestaetigt_am)}`;

/** A pending registration's record title, under the pupil's; its team gone, the season alone names it. */
export const registrierungTitel = (registrierung: { readonly team_name: string | null; readonly saison_id: string }): string =>
  registrierung.team_name === null
    ? `${SPIELER_TITEL}: Registrierung für die Saison ${registrierung.saison_id}`
    : `${SPIELER_TITEL}: Registrierung für ${registrierung.team_name}, Saison ${registrierung.saison_id}`;
