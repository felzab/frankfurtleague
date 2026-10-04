import { gekeyteFassung } from "@/core/einwilligungSeiten";
import { ABSATZ_CLASSES, Gefuellt } from "@/features/bewerbungen/components/ui/Gefuellt";
import { BEWERBUNG_MIN_ALTER, VERTRETUNG_MIN_ALTER } from "@/features/bewerbungen/constants";
import { MEDIEN_MIN_ALTER } from "@/features/registrierungen/constants";

import type { FLEinwilligungFassung } from "@/core/schemas";
import type { FLKontaktRolle } from "@/features/bewerbungen/schemas";
import type { Slots } from "@/shared/utils/stampedSlots";
import type { EinwilligungWorte } from "./EinwilligungForm";

// Each list is its page's whole set, as `fl_frontend/src/core/einwilligungSeiten.ts` keeps the
// confirmation pages': a served map missing a key or holding one more is refused, never rendered with a gap.
const PERSON_ABSATZ_SCHLUESSEL = ["veroeffentlichung", "medien", "widerruf"] as const;
const SITZ_ABSATZ_SCHLUESSEL = ["medien", "widerruf"] as const;
const UMFANG_SCHLUESSEL = ["kader_oeffentlich", "intern"] as const;

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

/** The control's words for one team season's contact seats: a media choice alone, the scope being no publication choice. */
export function sitzWorte(fassung: FLEinwilligungFassung, sitz: { readonly team_name: string; readonly saison_id: string }): EinwilligungWorte {
  const gekeyt = gekeyteFassung(fassung, SITZ_ABSATZ_SCHLUESSEL);
  const werte: Slots = { medienMinAlter: String(MEDIEN_MIN_ALTER), team: sitz.team_name, saison: sitz.saison_id };

  return {
    textVersion: gekeyt.textVersion,
    medien: { schalter: gekeyt.schalter, absatz: absatz(gekeyt.absaetze.medien, werte) },
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

/**
 * The floor a seat holder's page named: the highest any seat they hold on that row asks, as
 * `fl_backend/app/api/bewerbungen/services.py :: mindestalter_for` judges it.
 */
export const sitzMindestalter = (rollen: readonly FLKontaktRolle[]): number =>
  Math.max(...rollen.map((rolle) => (rolle === "trainer" ? BEWERBUNG_MIN_ALTER : VERTRETUNG_MIN_ALTER)));

/** A seat's record title, which names the team season the control moves; the switch's own words are the same on every seat. */
export const sitzTitel = (sitz: { readonly team_name: string; readonly saison_id: string }): string =>
  `Fotos, Videos und Interviews: ${sitz.team_name}, Saison ${sitz.saison_id}`;
