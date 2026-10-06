import { getEinwilligungFassung, getLaufendeFassung } from "@/core/einwilligung";
import { FESTE_WERTE } from "@/features/bewerbungen/components/ui/Gefuellt";
import { ABLEHNEN_LABEL, rollenLangform } from "@/features/bewerbungen/constants";
import { patchBewerbungEinwilligungAction, patchSitzEinwilligungAction } from "@/features/kontakte/personActions";
import { RegistrierungAngaben } from "@/features/registrierungen/components/ui/RegistrierungAngaben";
import { MEDIEN_MIN_ALTER, REGISTRIERUNG_MIN_ALTER, SPIELER_UMFANG_FRAGE } from "@/features/registrierungen/constants";
import { patchRegistrierungEinwilligungAction } from "@/features/registrierungen/personActions";
import { SchiedsrichterAngaben } from "@/features/schiedsrichter/components/ui/SchiedsrichterAngaben";
import { SCHIEDSRICHTER_MIN_ALTER, SCHIEDSRICHTER_UMFANG_FRAGE } from "@/features/schiedsrichter/constants";
import { patchSchiedsrichterEinwilligungAction } from "@/features/schiedsrichter/personActions";
import { SpielerAngaben } from "@/features/spieler/components/ui/SpielerAngaben";
import { patchSpielerEinwilligungAction } from "@/features/spieler/personActions";

import { getKontoEinwilligungen } from "../../queries";
import { EinwilligungForm } from "../forms/EinwilligungForm/EinwilligungForm";
import { EinwilligungPanel } from "../forms/EinwilligungForm/EinwilligungPanel";
import {
  bestaetigteWorte,
  bewerbungTitel,
  registrierungTitel,
  schiedsrichterTitel,
  schiedsrichterWorte,
  sitzTitel,
  sitzWorte,
  SPIELER_TITEL,
  spielerWorte,
} from "../forms/EinwilligungForm/kontoWorte";

import type { EinwilligungEintrag } from "../forms/EinwilligungForm/EinwilligungPanel";
import type { Fuellung } from "../forms/EinwilligungForm/kontoWorte";

/** The values every confirmation page names alike: the league's address and the erasure control's own name. */
const KONSTANTEN: Fuellung = { ...FESTE_WERTE, medienMinAlter: String(MEDIEN_MIN_ALTER) };

/** The words a record's person confirmed, or `null` where the record names no label the registry holds. */
async function bestaetigt(textVersion: string | null, fuellung: Fuellung) {
  if (textVersion === null) return null;
  const fassung = await getEinwilligungFassung(textVersion);

  return fassung === null ? null : bestaetigteWorte(fassung, fuellung);
}

/**
 * The account page's consent section, read on the server, the person's every confirmed record a control
 * of its own, each record's stored data beside it. Nothing for a person holding none, who is most of the
 * page's readers.
 */
export async function EinwilligungSection() {
  const { spieler, schiedsrichter, sitze, bewerbungen, registrierungen } = await getKontoEinwilligungen();
  const eintraege: EinwilligungEintrag[] = [];

  if (spieler !== null) {
    eintraege.push({
      id: `spieler-${spieler.spieler_id}`,
      titel: SPIELER_TITEL,
      angaben: (
        <SpielerAngaben
          spieler={spieler}
          kaderEbene="h5"
        />
      ),
      bestaetigt: await bestaetigt(spieler.bestaetigt_text_version, {
        ...KONSTANTEN,
        ...spieler.kontext,
        minAlter: String(REGISTRIERUNG_MIN_ALTER),
      }),
      control: (
        <EinwilligungForm
          // Withdraw-only where the pupil is not active, with the reason their label gives for it.
          worte={spielerWorte(await getLaufendeFassung("konto_spieler"), SPIELER_UMFANG_FRAGE, spieler.erteilbar ? undefined : "nichtAktiv")}
          gespeichert={{ umfang: spieler.einwilligung.umfang, medien: spieler.einwilligung.medien }}
          nachweisStand={spieler.nachweis_stand}
          medienAngeboten={spieler.medien_angeboten}
          erteilbar={spieler.erteilbar}
          speichereAction={patchSpielerEinwilligungAction}
        />
      ),
    });
  }

  if (schiedsrichter.length > 0) {
    const fassung = await getLaufendeFassung("konto_schiedsrichter");
    for (const eintrag of schiedsrichter) {
      eintraege.push({
        id: `schiedsrichter-${eintrag.schiedsrichter_id}`,
        titel: schiedsrichterTitel(eintrag),
        angaben: <SchiedsrichterAngaben eintrag={eintrag} />,
        bestaetigt: await bestaetigt(eintrag.bestaetigt_text_version, {
          ...KONSTANTEN,
          ...eintrag.kontext,
          minAlter: String(SCHIEDSRICHTER_MIN_ALTER),
        }),
        control: (
          <EinwilligungForm
            worte={schiedsrichterWorte(fassung, SCHIEDSRICHTER_UMFANG_FRAGE, !eintrag.erteilbar)}
            gespeichert={{ umfang: eintrag.einwilligung.umfang, medien: eintrag.einwilligung.medien }}
            nachweisStand={eintrag.nachweis_stand}
            medienAngeboten={eintrag.medien_angeboten}
            erteilbar={eintrag.erteilbar}
            // Bound here, never read off the page: one address may hold several referee rows.
            speichereAction={patchSchiedsrichterEinwilligungAction.bind(null, eintrag.schiedsrichter_id)}
          />
        ),
      });
    }
  }

  if (registrierungen.length > 0) {
    const fassung = await getLaufendeFassung("konto_spieler");
    for (const registrierung of registrierungen) {
      eintraege.push({
        id: `registrierung-${registrierung.registrierung_id}`,
        titel: registrierungTitel(registrierung),
        angaben: <RegistrierungAngaben registrierung={registrierung} />,
        bestaetigt: await bestaetigt(registrierung.bestaetigt_text_version, {
          ...KONSTANTEN,
          ...registrierung.kontext,
          minAlter: String(REGISTRIERUNG_MIN_ALTER),
        }),
        // A returning pupil's registration asks no choice: its data stands alone, their record holding the choices.
        ...(registrierung.umfang === null || registrierung.medien === null
          ? {}
          : {
              control: (
                <EinwilligungForm
                  worte={spielerWorte(fassung, SPIELER_UMFANG_FRAGE, "bisAufnahme")}
                  gespeichert={{ umfang: registrierung.umfang, medien: registrierung.medien }}
                  nachweisStand={registrierung.nachweis_stand}
                  // Withdraw-only: a grant on a pending registration waits on its team's admission.
                  medienAngeboten={false}
                  erteilbar={false}
                  speichereAction={patchRegistrierungEinwilligungAction.bind(null, registrierung.registrierung_id)}
                />
              ),
            }),
      });
    }
  }

  if (sitze.length > 0) {
    const fassung = await getLaufendeFassung("konto_kontakt");
    for (const sitz of sitze) {
      eintraege.push({
        id: `sitz-${sitz.team_id}-${sitz.saison_id}`,
        titel: sitzTitel(sitz),
        bestaetigt: await bestaetigt(sitz.bestaetigt_text_version, {
          ...KONSTANTEN,
          ...sitz.kontext,
          // Every seat held on the row, as the contact page named them and judged the age.
          rolle: rollenLangform(sitz.rollen),
          minAlter: String(sitz.mindestalter),
          ablehnen: ABLEHNEN_LABEL,
        }),
        control: (
          <EinwilligungForm
            // Withdraw-only on a past season or a withdrawn team, with the reason the label gives for it.
            worte={sitzWorte(fassung, sitz, sitz.erteilbar ? undefined : "vorbei")}
            gespeichert={{ umfang: sitz.umfang, medien: sitz.medien }}
            nachweisStand={sitz.nachweis_stand}
            medienAngeboten={sitz.medien_angeboten}
            erteilbar={sitz.erteilbar}
            speichereAction={patchSitzEinwilligungAction.bind(null, sitz.team_id, sitz.saison_id)}
          />
        ),
      });
    }
  }

  if (bewerbungen.length > 0) {
    const fassung = await getLaufendeFassung("konto_kontakt");
    for (const bewerbung of bewerbungen) {
      eintraege.push({
        id: `bewerbung-${bewerbung.bewerbung_id}`,
        titel: bewerbungTitel(bewerbung),
        bestaetigt: await bestaetigt(bewerbung.bestaetigt_text_version, {
          ...KONSTANTEN,
          ...bewerbung.kontext,
          rolle: rollenLangform(bewerbung.rollen),
          minAlter: String(bewerbung.mindestalter),
          ablehnen: ABLEHNEN_LABEL,
        }),
        control: (
          <EinwilligungForm
            worte={sitzWorte(fassung, { team_name: bewerbung.schule, saison_id: bewerbung.saison_id }, "bisZusage")}
            gespeichert={{ umfang: bewerbung.umfang, medien: bewerbung.medien }}
            nachweisStand={bewerbung.nachweis_stand}
            // Withdraw-only: a grant on a pending application is its confirmation page's alone.
            medienAngeboten={false}
            erteilbar={false}
            speichereAction={patchBewerbungEinwilligungAction.bind(null, bewerbung.bewerbung_id)}
          />
        ),
      });
    }
  }

  return <EinwilligungPanel eintraege={eintraege} />;
}
