import { cache } from "react";

import { apiClient } from "@/core/api";
import { runPersonRead } from "@/shared/utils/personRead";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import { postBestaetigungAnsicht, postEinladungAnsicht } from "./mutations";
import { FLOffeneRegistrierungenResponseSchema } from "./schemas";
import { einladungZustand, mapRegistrierungAnsichtRefusal } from "./utils";

import type { Leserichtung } from "@/shared/utils/leserichtung";
import type { FLOffeneRegistrierungenResponse } from "./schemas";
import type { RegistrierungStart, SpielerBestaetigungAnsicht } from "./types";

/**
 * A team's pending registrations, from one end of the queue: a capped read keeps the newest, so the
 * page offers the other end where `vollstaendig` is false. Never cached, the read being the person's
 * own; memoised per render pass.
 */
export const getOffeneRegistrierungen = cache(
  async (teamId: string, saisonId: string, filters: { order?: Leserichtung }): Promise<FLOffeneRegistrierungenResponse> =>
    runPersonRead(() =>
      apiClient<FLOffeneRegistrierungenResponse>(
        `/registrierungen/kader/${encodeURIComponent(teamId)}/${encodeURIComponent(saisonId)}`,
        FLOffeneRegistrierungenResponseSchema,
        { authType: "admin", params: filters },
      ),
    ),
);

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
