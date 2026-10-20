import { runAdminRead } from "@/shared/utils/adminRead";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import { ansichtOf } from "./link";
import { postAdresswechselAnsicht, postAdresswechselVerwaltungAnsicht } from "./mutations";
import { mapAdresswechselAnsichtRefusal, mapVerwaltungAnsichtRefusal } from "./refusals";

import type { AdresswechselAnsicht } from "./link";
import type { FLAdresswechselVerwaltungAnsichtResponse } from "./schemas";

/** What one address link opens, either side's, live or ended. */
export async function getAdresswechselAnsicht(token: string): Promise<AdresswechselAnsicht> {
  return runWithIncomingTrace(() =>
    postAdresswechselAnsicht({ token: token }).then(ansichtOf, (error: unknown): AdresswechselAnsicht => {
      // Anything but a refusal is a failed read, which is the page's own state rather than a panel
      // calling a live link void.
      const zustand = mapAdresswechselAnsichtRefusal(error);
      if (zustand !== null) return { zustand: zustand };
      throw error;
    }),
  );
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
