import { cache } from "react";

import { isRecordMissing } from "@/core/errors";
import { registrierungenGetOpenRegistrierungen, registrierungenGetRegistrierungenAdmin } from "@/core/generated/client/sdk";
import { runWithIncomingTrace } from "@/core/traceScope";
import { runAdminRead } from "@/shared/utils/adminRead";
import { runPersonRead } from "@/shared/utils/personRead";

import { postBestaetigungAnsicht, postEinladungAnsicht } from "./mutations";
import { einladungZustand, mapRegistrierungAnsichtRefusal } from "./utils";

import type { FLOpenRegistrierungenResponse, FLRegistrierungenAdminListResponse } from "@/core/generated/client/types";
import type { ReadingDirection } from "@/shared/utils/readingDirection";
import type { RegistrierungStart, SpielerBestaetigungAnsicht } from "./types";

/**
 * A team's pending registrations from one end of a capped queue, the page offering the other where
 * `vollstaendig` is false. Never cached, being the person's own; memoised per render pass on primitive
 * arguments alone, `cache` comparing them by identity.
 */
export const getOffeneRegistrierungen = cache(
  async (teamId: string, saisonId: string, order: ReadingDirection): Promise<FLOpenRegistrierungenResponse> =>
    runPersonRead(() => registrierungenGetOpenRegistrierungen(teamId, saisonId, { order: order })),
);

/** One season's pending registrations for the Registrierungen list, every team's; `null` where no season holds the id. */
export async function getRegistrierungenAdmin(saisonId: string): Promise<FLRegistrierungenAdminListResponse | null> {
  return runAdminRead(() =>
    registrierungenGetRegistrierungenAdmin({ saison_id: saisonId }).catch((error: unknown) => {
      if (isRecordMissing(error)) return null;
      throw error;
    }),
  );
}

/**
 * One invite's standing, read on every open and stored nowhere: a read records nothing, not even a
 * visit, because a chat client fetches every link somebody pastes.
 */
export async function getEinladungAnsicht(token: string): Promise<RegistrierungStart> {
  return runWithIncomingTrace(() =>
    postEinladungAnsicht({ token: token }).then(
      (view) => (einladungZustand(view) === "valid" ? { zustand: "valid", ansicht: view, token: token } : { zustand: "closed", ansicht: view }),
      (error: unknown) => {
        // Anything but a refusal is a failed read, which is the page's own state rather than a panel
        // calling a live invite void.
        const state = mapRegistrierungAnsichtRefusal(error);
        if (state !== null) return { zustand: state };
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
      (ansicht) => (ansicht.state === "valid" ? { zustand: "valid" as const, ansicht: ansicht } : { zustand: ansicht.state }),
      (error: unknown) => {
        const state = mapRegistrierungAnsichtRefusal(error);
        if (state !== null) return { zustand: state };
        throw error;
      },
    ),
  );
}
