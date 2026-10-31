import { getKontoSession } from "@/core/auth";
import { verwaltungOf } from "@/core/verwaltung";

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

  // The tier off the subject read the page's guard already made for this address, so no second backend call.
  const [adresswechsel, sicherheit, { verwaltung }] = await Promise.all([
    getKontoAdresswechsel(),
    readSicherheit(served),
    verwaltungOf(served.user.email),
  ]);
  if (!adresswechsel.possible) return null;

  const { freshUntil, enrolmentUntil, servedAt, inhaberId, inhaberAdresse } = sicherheit;
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
