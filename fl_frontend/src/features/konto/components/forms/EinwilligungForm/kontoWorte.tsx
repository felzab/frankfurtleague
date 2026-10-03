import { gekeyteFassung } from "@/core/einwilligungSeiten";
import { Gefuellt } from "@/features/bewerbungen/components/views/BestaetigungPanels";
import { MEDIEN_MIN_ALTER } from "@/features/registrierungen/constants";

import type { FLEinwilligungFassung } from "@/core/schemas";
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

/** A seat's record title, which names the team season the control moves; the switch's own words are the same on every seat. */
export const sitzTitel = (sitz: { readonly team_name: string; readonly saison_id: string }): string =>
  `Fotos, Videos und Interviews: ${sitz.team_name}, Saison ${sitz.saison_id}`;
