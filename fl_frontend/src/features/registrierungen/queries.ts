import { cache } from "react";

import { registrierungenGetOffeneRegistrierungen, registrierungenGetRegistrierungen } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";
import { runPersonRead } from "@/shared/utils/personRead";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import { postBestaetigungAnsicht, postEinladungAnsicht } from "./mutations";
import { einladungZustand, mapRegistrierungAnsichtRefusal } from "./utils";

import type { FLOffeneRegistrierungenResponse, FLRegistrierungenListResponse } from "@/core/generated/client/types";
import type { Leserichtung } from "@/shared/utils/leserichtung";
import type { RegistrierungStart, SpielerBestaetigungAnsicht } from "./types";

/**
 * A team's pending registrations from one end of a capped queue, the page offering the other where
 * `vollstaendig` is false. Never cached, being the person's own; memoised per render pass on primitive
 * arguments alone, `cache` comparing them by identity.
 */
export const getOffeneRegistrierungen = cache(
  async (teamId: string, saisonId: string, order: Leserichtung): Promise<FLOffeneRegistrierungenResponse> =>
    runPersonRead(() => registrierungenGetOffeneRegistrierungen(teamId, saisonId, { order: order })),
);

/**
 * Every season's pending registrations and never the header's season alone: a planned season's
 * stranded registrations would sit behind the selector, where nobody looks for them.
 */
export async function getAdminRegistrierungen(order: Leserichtung): Promise<FLRegistrierungenListResponse> {
  // `eingereicht` alone: a declined row waits out its month and asks nothing of an administrator.
  return runAdminRead(() => registrierungenGetRegistrierungen({ status: "eingereicht", order: order }));
}

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
 * Narrowed here rather than at the page, whose payload would carry the team and the season
 * regardless: a dead link's panel names nothing of the registration.
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
