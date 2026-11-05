"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { spielbestaetigungenEnterSpielbestaetigung } from "@/core/generated/client/sdk";
import { SpielbestaetigungenEnterSpielbestaetigungBody, SpielbestaetigungenEnterSpielbestaetigungParams } from "@/core/generated/zod/inputs";

/**
 * Records, from the Übersicht's row, that a party agreed to its fixture's date elsewhere than through its link: the
 * row the party chose in the dialog, and the reason saying how it reached the league, which the confirmation stores.
 * A row a seat answered meanwhile, or one closed since the page was read, is refused as the stale page it is.
 */
export const enterZusage = action({
  lane: "admin",
  name: "enterZusage",
  input: z.object({
    id: SpielbestaetigungenEnterSpielbestaetigungParams.shape.spielbestaetigung_id,
    begruendung: SpielbestaetigungenEnterSpielbestaetigungBody.shape.begruendung,
  }),
  run: async ({ id, begruendung }) => {
    await spielbestaetigungenEnterSpielbestaetigung(id, { begruendung });
    return { ok: true, value: undefined };
  },
});
