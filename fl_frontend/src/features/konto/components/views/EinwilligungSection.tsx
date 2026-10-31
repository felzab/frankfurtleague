import { getEinwilligungFassung, getLaufendeFassung } from "@/core/einwilligung";
import { FESTE_WERTE } from "@/features/bewerbungen/components/ui/Gefuellt";
import { ABLEHNEN_LABEL, rollenLangform } from "@/features/bewerbungen/constants";
import { patchBewerbungEinwilligungAction, patchSitzEinwilligungAction } from "@/features/kontakte/personActions";
import { RegistrierungAngaben } from "@/features/registrierungen/components/ui/RegistrierungAngaben";
import { SPIELER_UMFANG_FRAGE } from "@/features/registrierungen/constants";
import { patchRegistrierungEinwilligungAction } from "@/features/registrierungen/personActions";
import { SchiedsrichterAngaben } from "@/features/schiedsrichter/components/ui/SchiedsrichterAngaben";
import { SCHIEDSRICHTER_UMFANG_FRAGE } from "@/features/schiedsrichter/constants";
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
  sitzBestaetigungZeile,
  sitzTitel,
  sitzWorte,
  SPIELER_TITEL,
  spielerWorte,
} from "../forms/EinwilligungForm/kontoWorte";

import type { FLSeatConfirmed } from "@/core/generated/client/types";
import type { EinwilligungEintrag } from "../forms/EinwilligungForm/EinwilligungPanel";
import type { Fuellung } from "../forms/EinwilligungForm/kontoWorte";

/** The values every confirmation page names alike: the league's address and the erasure control's own name. */
const KONSTANTEN: Fuellung = FESTE_WERTE;

/** The words a record's person confirmed, or `null` where the registry holds no label of that name. */
async function bestaetigt(textVersion: string, fuellung: Fuellung) {
  const fassung = await getEinwilligungFassung(textVersion);

  return fassung === null ? null : bestaetigteWorte(fassung, fuellung);
}

/**
 * A row's seats' confirmed words, one block per confirmation, each filled with its own roles and floor
 * and headed by them: a Trainer who took a second seat later confirmed each under its own words.
 */
async function sitzBestaetigt(bestaetigungen: readonly FLSeatConfirmed[], medienMindestalter: number) {
  const bloecke = await Promise.all(
    bestaetigungen.map(async (bestaetigung) => ({
      bestaetigung: bestaetigung,
      worte: await bestaetigt(bestaetigung.text_version, {
        ...KONSTANTEN,
        ...bestaetigung.context,
        rolle: rollenLangform(bestaetigung.rollen),
        minAlter: String(bestaetigung.minimum_age),
        medienMinAlter: String(medienMindestalter),
        ablehnen: ABLEHNEN_LABEL,
      }),
    })),
  );
  const gezeigt = bloecke.filter(({ worte }) => worte !== null);
  if (gezeigt.length === 0) return null;

  return (
    <>
      {gezeigt.map(({ bestaetigung, worte }) => (
        <div
          key={`${bestaetigung.rollen.join("-")}-${bestaetigung.text_version ?? ""}`}
          className="flex flex-col gap-y-3">
          <p className="fluid-sm font-bold text-foreground">{sitzBestaetigungZeile(bestaetigung)}</p>
          {worte}
        </div>
      ))}
    </>
  );
}

/**
 * The account page's consent section, read on the server, the person's every confirmed record a control
 * of its own, each record's stored data beside it. Nothing for a person holding none, who is most of the
 * page's readers.
 */
export async function EinwilligungSection() {
  const { spieler, schiedsrichter, seats: sitze, bewerbungen, registrierungen } = await getKontoEinwilligungen();
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
      bestaetigt: await bestaetigt(spieler.confirmed_text_version, {
        ...KONSTANTEN,
        ...spieler.context,
        minAlter: String(spieler.minimum_age),
        medienMinAlter: String(spieler.medien_minimum_age),
      }),
      control: (
        <EinwilligungForm
          // Withdraw-only where the pupil is not active, with the reason their label gives for it.
          {...spielerWorte(
            await getLaufendeFassung("konto_spieler"),
            SPIELER_UMFANG_FRAGE,
            spieler,
            spieler.givable ? undefined : "nichtAktiv",
          )}
          gespeichert={{ umfang: spieler.einwilligung.umfang, medien: spieler.einwilligung.medien }}
          nachweisStand={spieler.nachweis_stand}
          medienAngeboten={spieler.medien_offered}
          medienMindestalter={spieler.medien_minimum_age}
          speichereAction={patchSpielerEinwilligungAction.bind(null, spieler.medien_minimum_age)}
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
        bestaetigt: await bestaetigt(eintrag.confirmed_text_version, {
          ...KONSTANTEN,
          minAlter: String(eintrag.minimum_age),
          medienMinAlter: String(eintrag.medien_minimum_age),
        }),
        control: (
          <EinwilligungForm
            {...schiedsrichterWorte(fassung, SCHIEDSRICHTER_UMFANG_FRAGE, eintrag, !eintrag.givable)}
            gespeichert={{ umfang: eintrag.einwilligung.umfang, medien: eintrag.einwilligung.medien }}
            nachweisStand={eintrag.nachweis_stand}
            medienAngeboten={eintrag.medien_offered}
            medienMindestalter={eintrag.medien_minimum_age}
            // Bound here, never read off the page: one address may hold several referee rows.
            speichereAction={patchSchiedsrichterEinwilligungAction.bind(null, eintrag.schiedsrichter_id, eintrag.medien_minimum_age)}
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
        bestaetigt: await bestaetigt(registrierung.confirmed_text_version, {
          ...KONSTANTEN,
          ...registrierung.context,
          minAlter: String(registrierung.minimum_age),
          medienMinAlter: String(registrierung.medien_minimum_age),
        }),
        // A returning pupil's registration asks no choice: its data stands alone, their record holding the choices.
        ...(registrierung.umfang === null || registrierung.medien === null
          ? {}
          : {
              control: (
                <EinwilligungForm
                  {...spielerWorte(fassung, SPIELER_UMFANG_FRAGE, registrierung, "bisAufnahme")}
                  gespeichert={{ umfang: registrierung.umfang, medien: registrierung.medien }}
                  nachweisStand={registrierung.nachweis_stand}
                  // Withdraw-only: a grant on a pending registration waits on its team's admission.
                  medienAngeboten={false}
                  medienMindestalter={registrierung.medien_minimum_age}
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
        bestaetigt: await sitzBestaetigt(sitz.confirmed, sitz.medien_minimum_age),
        control: (
          <EinwilligungForm
            // Withdraw-only on a past season or a withdrawn team, with the reason the label gives for it.
            {...sitzWorte(fassung, sitz, sitz.givable ? undefined : "vorbei")}
            gespeichert={{ umfang: sitz.umfang, medien: sitz.medien }}
            nachweisStand={sitz.nachweis_stand}
            medienAngeboten={sitz.medien_offered}
            medienMindestalter={sitz.medien_minimum_age}
            speichereAction={patchSitzEinwilligungAction.bind(null, sitz.team_id, sitz.saison_id, sitz.medien_minimum_age)}
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
        bestaetigt: await sitzBestaetigt(bewerbung.confirmed, bewerbung.medien_minimum_age),
        control: (
          <EinwilligungForm
            {...sitzWorte(
              fassung,
              { team_name: bewerbung.schule, saison_id: bewerbung.saison_id, medien_minimum_age: bewerbung.medien_minimum_age },
              "bisZusage",
            )}
            gespeichert={{ umfang: bewerbung.umfang, medien: bewerbung.medien }}
            nachweisStand={bewerbung.nachweis_stand}
            // Withdraw-only: a grant on a pending application is its confirmation page's alone.
            medienAngeboten={false}
            medienMindestalter={bewerbung.medien_minimum_age}
            speichereAction={patchBewerbungEinwilligungAction.bind(null, bewerbung.bewerbung_id)}
          />
        ),
      });
    }
  }

  return <EinwilligungPanel eintraege={eintraege} />;
}
