import {
  SCHIEDSRICHTER_TEXT_VERSIONS,
  SCHIEDSRICHTER_WORDINGS,
  SEAT_TEXT_VERSIONS,
  SEAT_WORDINGS,
  SPIELER_TEXT_VERSIONS,
  SPIELER_WORDINGS,
} from "@/core/consentWordings";
import { EinwilligungZeilenTeile } from "@/features/bewerbungen/components/views/BestaetigungHinweise";
import { rollenLangform } from "@/features/bewerbungen/constants";

import type { FLKontaktRolle } from "@/core/generated/client/types";
import type { Gewaehrung, PersonUmfang, SitzUmfang } from "./EinwilligungForm";

/** The control's words for a pupil's record or pending registration, from the pupil's two wordings; withdraw-only where `erteilbar` is false. */
export function spielerWorte(erteilbar: boolean): Gewaehrung<PersonUmfang, typeof SPIELER_TEXT_VERSIONS> {
  return {
    erteilbar: erteilbar,
    worte: {
      textVersions: SPIELER_TEXT_VERSIONS,
      umfang: {
        frage: SPIELER_WORDINGS.umfang.question,
        optionen: SPIELER_WORDINGS.umfang.options,
        absatz: <EinwilligungZeilenTeile line={SPIELER_WORDINGS.umfang.line} />,
      },
      medien: { schalter: SPIELER_WORDINGS.medien.label, absatz: <EinwilligungZeilenTeile line={SPIELER_WORDINGS.medien.line} /> },
    },
  };
}

/** The control's words for a referee's record, from the referee's two wordings; withdraw-only where `erteilbar` is false. */
export function schiedsrichterWorte(erteilbar: boolean): Gewaehrung<PersonUmfang, typeof SCHIEDSRICHTER_TEXT_VERSIONS> {
  return {
    erteilbar: erteilbar,
    worte: {
      textVersions: SCHIEDSRICHTER_TEXT_VERSIONS,
      umfang: {
        frage: SCHIEDSRICHTER_WORDINGS.umfang.question,
        optionen: SCHIEDSRICHTER_WORDINGS.umfang.options,
        absatz: <EinwilligungZeilenTeile line={SCHIEDSRICHTER_WORDINGS.umfang.line} />,
      },
      medien: {
        schalter: SCHIEDSRICHTER_WORDINGS.medien.label,
        absatz: <EinwilligungZeilenTeile line={SCHIEDSRICHTER_WORDINGS.medien.line} />,
      },
    },
  };
}

/** The control's words for one team season's contact seats: WhatsApp beside the media choice, each a switch. */
export function sitzWorte(erteilbar: boolean): Gewaehrung<SitzUmfang, typeof SEAT_TEXT_VERSIONS> {
  return {
    erteilbar: erteilbar,
    worte: {
      textVersions: SEAT_TEXT_VERSIONS,
      whatsapp: {
        schalter: SEAT_WORDINGS.umfang.label,
        an: "kontaktdaten_whatsapp",
        aus: "kontaktdaten",
        absatz: <EinwilligungZeilenTeile line={SEAT_WORDINGS.umfang.line} />,
      },
      medien: { schalter: SEAT_WORDINGS.medien.label, absatz: <EinwilligungZeilenTeile line={SEAT_WORDINGS.medien.line} /> },
    },
  };
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

/** A pending registration's record title, under the pupil's; its team gone, the season alone names it. */
export const registrierungTitel = (registrierung: { readonly team_name: string | null; readonly saison_id: string }): string =>
  registrierung.team_name === null
    ? `${SPIELER_TITEL}: Registrierung für die Saison ${registrierung.saison_id}`
    : `${SPIELER_TITEL}: Registrierung für ${registrierung.team_name}, Saison ${registrierung.saison_id}`;
