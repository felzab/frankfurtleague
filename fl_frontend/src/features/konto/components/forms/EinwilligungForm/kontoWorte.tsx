import { gekeyteFassung } from "@/core/einwilligungSeiten";
import { ABSATZ_CLASSES, Gefuellt } from "@/features/bewerbungen/components/ui/Gefuellt";
import { rollenLangform } from "@/features/bewerbungen/constants";
import { MEDIEN_MIN_ALTER } from "@/features/registrierungen/constants";

import type { FLEinwilligungFassung } from "@/core/schemas";
import type { FLKontaktRolle } from "@/features/bewerbungen/schemas";
import type { Slots } from "@/shared/utils/stampedSlots";
import type { EinwilligungWorte } from "./EinwilligungForm";

// Each list is its page's whole set, as `fl_frontend/src/core/einwilligungSeiten.ts` keeps the
// confirmation pages': a served map missing a key or holding one more is refused, never rendered with a gap.
const PERSON_ABSATZ_SCHLUESSEL = ["veroeffentlichung", "medien", "widerruf"] as const;
const SITZ_ABSATZ_SCHLUESSEL = ["whatsapp", "medien", "widerruf"] as const;
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

/**
 * The control's words for a pupil's or a referee's record, from the account page's own running
 * wording for that kind. `frage` is the kind's own question, which the registry does not stamp.
 */
export function personWorte(fassung: FLEinwilligungFassung, frage: string): EinwilligungWorte {
  const gekeyt = gekeyteFassung(fassung, PERSON_ABSATZ_SCHLUESSEL, UMFANG_SCHLUESSEL);
  const werte: Slots = { medienMinAlter: String(MEDIEN_MIN_ALTER) };

  return {
    textVersion: gekeyt.textVersion,
    umfang: { frage: frage, optionen: gekeyt.bedienelemente, absatz: absatz(gekeyt.absaetze.veroeffentlichung, werte) },
    medien: { schalter: gekeyt.schalter, absatz: absatz(gekeyt.absaetze.medien, werte) },
    widerruf: absatz(gekeyt.absaetze.widerruf, werte),
  };
}

/** The control's words for one team season's contact seats: WhatsApp beside the media choice, each a switch. */
export function sitzWorte(fassung: FLEinwilligungFassung, sitz: { readonly team_name: string; readonly saison_id: string }): EinwilligungWorte {
  const gekeyt = gekeyteFassung(fassung, SITZ_ABSATZ_SCHLUESSEL, SITZ_UMFANG_SCHLUESSEL);
  const werte: Slots = { medienMinAlter: String(MEDIEN_MIN_ALTER), team: sitz.team_name, saison: sitz.saison_id };

  return {
    textVersion: gekeyt.textVersion,
    whatsapp: { schalter: gekeyt.bedienelemente.kontaktdaten_whatsapp, absatz: absatz(gekeyt.absaetze.whatsapp, werte) },
    medien: { schalter: gekeyt.schalter, absatz: absatz(gekeyt.absaetze.medien, werte) },
    widerruf: absatz(gekeyt.absaetze.widerruf, werte),
  };
}

// „erteilen“ and never „wieder zustimmen“: most seats reading it never agreed to the choice it is about.
/**
 * Why a pending application's seat takes a withdrawal alone: a grant there is its confirmation page's,
 * and the seat reaches the account page's full control once the team is accepted.
 */
export const NUR_WIDERRUF_BIS_ZUSAGE =
  "Solange über die Bewerbung nicht entschieden ist, kannst Du eine Erlaubnis hier nur zurücknehmen. Nach einer Zusage kannst Du sie hier auch erteilen.";

/** Why a pending registration takes a withdrawal alone, for `NUR_WIDERRUF_BIS_ZUSAGE`'s reasons: its team admits it or not. */
export const NUR_WIDERRUF_BIS_AUFNAHME =
  "Solange Dein Team über Deine Registrierung nicht entschieden hat, kannst Du eine Erlaubnis hier nur zurücknehmen. Nimmt Dein Team Dich auf, kannst Du sie hier auch erteilen.";

/** A pending application's seats: a seat's words, with the reason a withdrawal is all they offer. */
export function bewerbungWorte(
  fassung: FLEinwilligungFassung,
  bewerbung: { readonly schule: string; readonly saison_id: string },
): EinwilligungWorte {
  return { ...sitzWorte(fassung, { team_name: bewerbung.schule, saison_id: bewerbung.saison_id }), nurWiderruf: NUR_WIDERRUF_BIS_ZUSAGE };
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

/** A pending registration's record title; its team gone, the season alone names it. */
export const registrierungTitel = (registrierung: { readonly team_name: string | null; readonly saison_id: string }): string =>
  registrierung.team_name === null
    ? `Registrierung: Saison ${registrierung.saison_id}`
    : `Registrierung: ${registrierung.team_name}, Saison ${registrierung.saison_id}`;
