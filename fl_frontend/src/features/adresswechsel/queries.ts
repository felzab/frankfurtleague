import { accountStandsAt } from "@/core/auth";
import { runAdminRead } from "@/shared/utils/adminRead";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import { ansichtOf } from "./link";
import { postAdresswechselAdresse, postAdresswechselAnsicht, postAdresswechselVerwaltungAnsicht } from "./mutations";
import { mapAdresswechselAnsichtRefusal, mapVerwaltungAnsichtRefusal } from "./refusals";

import type { AdresswechselAnsicht } from "./link";
import type { FLAdresswechselAdressePayload, FLAdresswechselVerwaltungAnsichtResponse } from "./schemas";

/**
 * Whether a sign-in account already stands at the new address of the live change the key names, which refuses the
 * change. The address stays inside this call: no caller, page or log line is handed it.
 */
export async function kontoAnNeuerAdresse(schluessel: FLAdresswechselAdressePayload): Promise<boolean> {
  const { email } = await postAdresswechselAdresse(schluessel);
  return email !== null && (await accountStandsAt(email));
}

/** What one address link opens, either side's, live or ended. */
export async function getAdresswechselAnsicht(token: string): Promise<AdresswechselAnsicht> {
  return runWithIncomingTrace(async () => {
    const gelesen = await postAdresswechselAnsicht({ token: token }).then(ansichtOf, (error: unknown): AdresswechselAnsicht => {
      // Anything but a refusal is a failed read, which is the page's own state rather than a panel
      // calling a live link void.
      const zustand = mapAdresswechselAnsichtRefusal(error);
      if (zustand !== null) return { zustand: zustand };
      throw error;
    });

    // The backend cannot see the sign-in store, so its view offers the press this refusal closes: said here, as the
    // backend's own refusals of the address are, so the page never offers a confirmation the press refuses.
    if (gelesen.zustand === "gueltig" && (await kontoAnNeuerAdresse({ token: token }))) {
      return { zustand: "nicht_bestaetigbar", weg: gelesen.weg };
    }
    return gelesen;
  });
}

/** What the address tool shows of one change or address: the read's answer, or the sentence of its own refusal. */
export type VerwaltungAnsichtGelesen =
  { status: "read"; ansicht: Omit<FLAdresswechselVerwaltungAnsichtResponse, "acknowledged"> } | { status: "refused"; reason: string };

/** The change a link from an editor, a reveal or the account page names, read as the tool opens on it. */
export async function getAdresswechselVerwaltungAnsicht(adresswechselId: string): Promise<VerwaltungAnsichtGelesen> {
  return runAdminRead(() => postAdresswechselVerwaltungAnsicht({ adresswechsel_id: adresswechselId })).then(
    (ansicht): VerwaltungAnsichtGelesen => ({ status: "read", ansicht: ansicht }),
    (error: unknown): VerwaltungAnsichtGelesen => {
      // An ended or unknown change is the panel's sentence; every other failure is the page's boundary.
      const reason = mapVerwaltungAnsichtRefusal(error);
      if (reason !== null) return { status: "refused", reason: reason };
      throw error;
    },
  );
}
