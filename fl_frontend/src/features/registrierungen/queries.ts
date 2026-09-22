import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import { postBestaetigungAnsicht, postEinladungAnsicht } from "./mutations";
import { einladungZustand, mapRegistrierungAnsichtRefusal } from "./utils";

import type { RegistrierungStart, SpielerBestaetigungAnsicht } from "./types";

/**
 * One invite's standing, read on every open and stored nowhere: a read records nothing, not even a
 * visit, because a chat client fetches every link somebody pastes.
 */
export async function getEinladungAnsicht(token: string): Promise<RegistrierungStart> {
  return runWithIncomingTrace(() =>
    postEinladungAnsicht({ token: token }).then(
      (ansicht) =>
        einladungZustand(ansicht) === "gueltig"
          ? { zustand: "gueltig", ansicht: ansicht, token: token }
          : { zustand: "geschlossen", ansicht: ansicht },
      (error: unknown) => {
        // Anything but a refusal is a failed read, which is the page's own state rather than a panel
        // calling a live invite void.
        const zustand = mapRegistrierungAnsichtRefusal(error);
        if (zustand !== null) return { zustand: zustand };
        throw error;
      },
    ),
  );
}

/**
 * One confirmation link's standing, read for `getEinladungAnsicht`'s reason.
 *
 * Narrowed here rather than at the page, whose payload would carry the name regardless: a dead
 * link's panel names nobody.
 */
export async function getSpielerBestaetigungAnsicht(token: string): Promise<SpielerBestaetigungAnsicht> {
  return runWithIncomingTrace(() =>
    postBestaetigungAnsicht({ token: token }).then(
      (ansicht) => (ansicht.zustand === "gueltig" ? { zustand: "gueltig" as const, ansicht: ansicht } : { zustand: ansicht.zustand }),
      (error: unknown) => {
        const zustand = mapRegistrierungAnsichtRefusal(error);
        if (zustand !== null) return { zustand: zustand };
        throw error;
      },
    ),
  );
}
