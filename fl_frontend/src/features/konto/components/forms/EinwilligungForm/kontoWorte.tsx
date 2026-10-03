import { Gefuellt } from "@/features/bewerbungen/components/views/BestaetigungPanels";
import { MEDIEN_MIN_ALTER } from "@/features/registrierungen/constants";

import type { Slots } from "@/shared/utils/stampedSlots";
import type { EinwilligungWorte } from "./EinwilligungForm";

/** The part of a served wording the account page's controls are drawn from. */
export type KontoFassung = {
  readonly text_version: string;
  readonly schalter: string;
  readonly bedienelemente: Readonly<Record<string, string>>;
  readonly absaetze_nach_schluessel: Readonly<Record<string, string>> | null;
};

// Not stamped, as the confirmation pages' own questions are not: the chips under it carry the stamped
// words, and the question is the group's name.
export const UMFANG_FRAGE_SPIELER = "Was darf von Deinem Namen auf der Website stehen?";
export const UMFANG_FRAGE_SCHIEDSRICHTER = "Was darf von Deinem Namen im Spielplan stehen?";

/** A section the running label must carry: a wording missing one is a registry fault, never a blank paragraph. */
function abschnitt(fassung: KontoFassung, schluessel: string): string {
  const text = fassung.absaetze_nach_schluessel?.[schluessel];
  if (text === undefined) throw new Error(`the wording ${fassung.text_version} carries no section ${schluessel}`);
  return text;
}

function bedienelement(fassung: KontoFassung, wert: "kader_oeffentlich" | "intern"): string {
  const text = fassung.bedienelemente[wert];
  if (text === undefined) throw new Error(`the wording ${fassung.text_version} carries no control ${wert}`);
  return text;
}

/** The person's own values a sentence names, set apart as the confirmation pages set them. */
const EIGENE = new Set(["team", "saison"]);

const absatz = (fassung: KontoFassung, schluessel: string, werte: Slots) => (
  <Gefuellt
    text={abschnitt(fassung, schluessel)}
    werte={werte}
    eigene={EIGENE}
  />
);

/**
 * The control's words for a pupil's or a referee's record, from the account page's own running
 * wording for that kind. `frage` is the kind's own question.
 */
export function personWorte(fassung: KontoFassung, frage: string): EinwilligungWorte {
  const werte: Slots = { medienMinAlter: String(MEDIEN_MIN_ALTER) };

  return {
    textVersion: fassung.text_version,
    umfang: {
      frage: frage,
      optionen: { kader_oeffentlich: bedienelement(fassung, "kader_oeffentlich"), intern: bedienelement(fassung, "intern") },
      absatz: absatz(fassung, "veroeffentlichung", werte),
    },
    medien: { schalter: fassung.schalter, absatz: absatz(fassung, "medien", werte) },
    widerruf: absatz(fassung, "widerruf", werte),
  };
}

/** The control's words for one team season's contact seats: a media choice alone, the scope being no publication choice. */
export function sitzWorte(fassung: KontoFassung, sitz: { readonly team_name: string; readonly saison_id: string }): EinwilligungWorte {
  const werte: Slots = { medienMinAlter: String(MEDIEN_MIN_ALTER), team: sitz.team_name, saison: sitz.saison_id };

  return {
    textVersion: fassung.text_version,
    medien: { schalter: fassung.schalter, absatz: absatz(fassung, "medien", werte) },
    widerruf: absatz(fassung, "widerruf", werte),
  };
}

/** A seat's record title, which names the team season the control moves; the switch's own words are the same on every seat. */
export const sitzTitel = (sitz: { readonly team_name: string; readonly saison_id: string }): string =>
  `Fotos, Videos und Interviews: ${sitz.team_name}, Saison ${sitz.saison_id}`;
