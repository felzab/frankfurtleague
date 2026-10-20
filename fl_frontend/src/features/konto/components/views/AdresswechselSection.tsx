import { getKontoSession } from "@/core/auth";

import { getKontoAdresswechsel } from "../../queries";
import { readSicherheit } from "../../sicherheit";
import { AdresswechselPanel } from "../forms/AdresswechselForm/AdresswechselPanel";

/**
 * The address control the account page hands `KontoPanel`'s „Anmeldung“ panel, read on the server.
 * Nothing for a session the account's own guard refuses, nor for an address holding no record whose
 * address the change moves.
 */
export async function AdresswechselSection() {
  const served = await getKontoSession();
  if (served === null) return null;

  const [adresswechsel, sicherheit] = await Promise.all([getKontoAdresswechsel(), readSicherheit(served)]);
  if (!adresswechsel.moeglich) return null;

  const { freshUntil, enrolmentUntil, servedAt, verwaltung, inhaberId, inhaberAdresse } = sicherheit;
  return (
    <AdresswechselPanel
      adresswechsel={adresswechsel}
      bestaetigung={{
        freshUntil,
        enrolmentUntil,
        servedAt,
        hasPasskey: sicherheit.passkeys.length > 0,
        verwaltung,
        inhaberId,
        inhaberAdresse,
      }}
    />
  );
}
