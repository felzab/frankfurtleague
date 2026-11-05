// Session 6: goes with the old team editor, the group swap's last old caller.
import z from "zod";

import { CustomObjectIdStringSchema } from "@/shared/schemas";

import { SAISON_ID_LENGTH } from "./constants";

/**
 * **Neither side carries a group**: the backend reads the two junction rows inside the transaction, so
 * a form built against a season that has since moved cannot write a group nobody stands in.
 */
export const FLSwapGruppenPayloadSchema = z.object({
  saison_id: z.string().length(SAISON_ID_LENGTH, { error: `Die Saison-ID besteht aus genau ${String(SAISON_ID_LENGTH)} Zeichen.` }),
  team1_id: CustomObjectIdStringSchema,
  team2_id: CustomObjectIdStringSchema,
});
