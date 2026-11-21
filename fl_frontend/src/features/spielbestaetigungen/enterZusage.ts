"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { spielbestaetigungenEnterSpielbestaetigung } from "@/core/generated/client/sdk";
import { SpielbestaetigungenEnterSpielbestaetigungBody, SpielbestaetigungenEnterSpielbestaetigungParams } from "@/core/generated/zod/inputs";

/**
 * Records, from a fixture's row on the Übersicht or a party's in the match editor, that a party agreed to its fixture's
 * date elsewhere than signed in: the row the party chose in the dialog, and the reason saying how it reached the
 * league, which the confirmation stores. A row a seat answered meanwhile, or one closed or left by its fixture since
 * the page was read, is refused as the stale page it is.
 */
export const enterZusage = action({
  lane: "admin",
  name: "enterZusage",
  input: z.object({
    id: SpielbestaetigungenEnterSpielbestaetigungParams.shape.spielbestaetigung_id,
    reason: SpielbestaetigungenEnterSpielbestaetigungBody.shape.reason,
  }),
  run: async ({ id, reason }) => {
    await spielbestaetigungenEnterSpielbestaetigung(id, { reason });
    return { ok: true, value: undefined };
  },
});
