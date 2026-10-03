import { KONTAKT_EMAIL } from "@/core/brand";
import { getEinwilligungFassung, getLaufendeFassung } from "@/core/einwilligung";
import { patchSitzEinwilligungAction } from "@/features/kontakte/personActions";
import { MEDIEN_MIN_ALTER, REGISTRIERUNG_MIN_ALTER, SPIELER_UMFANG_FRAGE } from "@/features/registrierungen/constants";
import { SCHIEDSRICHTER_MIN_ALTER, SCHIEDSRICHTER_UMFANG_FRAGE } from "@/features/schiedsrichter/constants";
import { patchSchiedsrichterEinwilligungAction } from "@/features/schiedsrichter/personActions";
import { patchSpielerEinwilligungAction } from "@/features/spieler/personActions";

import { getKontoEinwilligungen } from "../../queries";
import { EinwilligungPanel } from "../forms/EinwilligungForm/EinwilligungPanel";
import { bestaetigteWorte, personWorte, sitzTitel, sitzWorte } from "../forms/EinwilligungForm/kontoWorte";

import type { Slots } from "@/shared/utils/stampedSlots";
import type { EinwilligungEintrag } from "../forms/EinwilligungForm/EinwilligungPanel";

/** The values every confirmation page names alike: the league's address and the erasure control's own name. */
const KONSTANTEN: Slots = { kontakt: KONTAKT_EMAIL, loeschung: "Konto löschen", medienMinAlter: String(MEDIEN_MIN_ALTER) };

/** The words a record's person confirmed, or `null` where the record names no label the registry holds. */
async function bestaetigt(textVersion: string | null, werte: Slots) {
  if (textVersion === null) return null;
  const fassung = await getEinwilligungFassung(textVersion);

  return fassung === null ? null : bestaetigteWorte(fassung, werte);
}

/**
 * The account page's consent section, read on the server, the person's every confirmed record a control
 * of its own. Nothing for a person holding none, who is most of the page's readers.
 */
export async function EinwilligungSection() {
  const { spieler, schiedsrichter, sitze } = await getKontoEinwilligungen();
  const eintraege: EinwilligungEintrag[] = [];

  if (spieler !== null) {
    eintraege.push({
      id: `spieler-${spieler.spieler_id}`,
      titel: "Als Spieler",
      bestaetigt: await bestaetigt(spieler.bestaetigt_text_version, {
        ...KONSTANTEN,
        vorname: spieler.vorname,
        minAlter: String(REGISTRIERUNG_MIN_ALTER),
      }),
      worte: personWorte(await getLaufendeFassung("konto_spieler"), SPIELER_UMFANG_FRAGE),
      gespeichert: { umfang: spieler.einwilligung.umfang, medien: spieler.einwilligung.medien },
      medienAngeboten: spieler.medien_angeboten,
      erteilbar: spieler.erteilbar,
      speichereAction: patchSpielerEinwilligungAction,
    });
  }

  if (schiedsrichter.length > 0) {
    const fassung = await getLaufendeFassung("konto_schiedsrichter");
    for (const eintrag of schiedsrichter) {
      eintraege.push({
        id: `schiedsrichter-${eintrag.schiedsrichter_id}`,
        titel: "Als Schiedsrichter",
        bestaetigt: await bestaetigt(eintrag.bestaetigt_text_version, { ...KONSTANTEN, minAlter: String(SCHIEDSRICHTER_MIN_ALTER) }),
        worte: personWorte(fassung, SCHIEDSRICHTER_UMFANG_FRAGE),
        gespeichert: { umfang: eintrag.einwilligung.umfang, medien: eintrag.einwilligung.medien },
        medienAngeboten: eintrag.medien_angeboten,
        erteilbar: eintrag.erteilbar,
        // Bound here, never read off the page: one address may hold several referee rows.
        speichereAction: patchSchiedsrichterEinwilligungAction.bind(null, eintrag.schiedsrichter_id),
      });
    }
  }

  if (sitze.length > 0) {
    const fassung = await getLaufendeFassung("konto_kontakt");
    for (const sitz of sitze) {
      eintraege.push({
        id: `sitz-${sitz.team_id}-${sitz.saison_id}`,
        titel: sitzTitel(sitz),
        bestaetigt: await bestaetigt(sitz.bestaetigt_text_version, { ...KONSTANTEN, saison: sitz.saison_id }),
        worte: sitzWorte(fassung, sitz),
        gespeichert: { medien: sitz.medien },
        medienAngeboten: sitz.medien_angeboten,
        erteilbar: sitz.erteilbar,
        speichereAction: patchSitzEinwilligungAction.bind(null, sitz.team_id, sitz.saison_id),
      });
    }
  }

  return <EinwilligungPanel eintraege={eintraege} />;
}
