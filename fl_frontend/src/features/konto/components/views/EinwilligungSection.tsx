import { patchBewerbungEinwilligungAction, patchSitzEinwilligungAction } from "@/features/kontakte/personActions";
import { RegistrierungAngaben } from "@/features/registrierungen/components/ui/RegistrierungAngaben";
import { patchRegistrierungEinwilligungAction } from "@/features/registrierungen/personActions";
import { SchiedsrichterAngaben } from "@/features/schiedsrichter/components/ui/SchiedsrichterAngaben";
import { patchSchiedsrichterEinwilligungAction } from "@/features/schiedsrichter/personActions";
import { SpielerAngaben } from "@/features/spieler/components/ui/SpielerAngaben";
import { patchSpielerEinwilligungAction } from "@/features/spieler/personActions";

import { getKontoEinwilligungen } from "../../queries";
import { EinwilligungForm } from "../forms/EinwilligungForm/EinwilligungForm";
import { EinwilligungPanel } from "../forms/EinwilligungForm/EinwilligungPanel";
import {
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
      bestaetigt: null,
      control: (
        <EinwilligungForm
          // Withdraw-only where the pupil is not active.
          {...spielerWorte(spieler.givable)}
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
    for (const eintrag of schiedsrichter) {
      eintraege.push({
        id: `schiedsrichter-${eintrag.schiedsrichter_id}`,
        titel: schiedsrichterTitel(eintrag),
        angaben: <SchiedsrichterAngaben eintrag={eintrag} />,
        bestaetigt: null,
        control: (
          <EinwilligungForm
            {...schiedsrichterWorte(eintrag.givable)}
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
    for (const registrierung of registrierungen) {
      eintraege.push({
        id: `registrierung-${registrierung.registrierung_id}`,
        titel: registrierungTitel(registrierung),
        angaben: <RegistrierungAngaben registrierung={registrierung} />,
        bestaetigt: null,
        // A returning pupil's registration asks no choice: its data stands alone, their record holding the choices.
        ...(registrierung.umfang === null || registrierung.medien === null
          ? {}
          : {
              control: (
                <EinwilligungForm
                  {...spielerWorte(false)}
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
    for (const sitz of sitze) {
      eintraege.push({
        id: `sitz-${sitz.team_id}-${sitz.saison_id}`,
        titel: sitzTitel(sitz),
        bestaetigt: null,
        control: (
          <EinwilligungForm
            // Withdraw-only on a past season or a withdrawn team.
            {...sitzWorte(sitz.givable)}
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
    for (const bewerbung of bewerbungen) {
      eintraege.push({
        id: `bewerbung-${bewerbung.bewerbung_id}`,
        titel: bewerbungTitel(bewerbung),
        bestaetigt: null,
        control: (
          <EinwilligungForm
            {...sitzWorte(false)}
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
