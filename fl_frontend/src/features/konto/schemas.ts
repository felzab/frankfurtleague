import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { FLKontaktRolleSchema } from "@/features/bewerbungen/schemas";
import { FLSchiedsrichterSelbstSchema } from "@/features/schiedsrichter/schemas";
import { FLSpielerSelbstSchema } from "@/features/spieler/schemas";
import { CustomObjectIdStringSchema } from "@/shared/schemas";

/**
 * Mirrors `FLKontoSitzEinwilligung`: one entry per team season, however many of its seats the person
 * holds, because one press moves the media choice on every one of them.
 */
export const FLKontoSitzEinwilligungSchema = z.object({
  team_id: CustomObjectIdStringSchema,
  team_name: z.string(),
  saison_id: z.string(),
  rollen: z.array(FLKontaktRolleSchema).nonempty(),
  text_version: z.string().nullable(),
  // The label the person confirmed, which the account page shows beside the control: the block's own
  // label above is the latest press's once one has been made.
  bestaetigt_text_version: z.string().nullable(),
  medien: z.boolean(),
  medien_angeboten: z.boolean(),
  erteilbar: z.boolean(),
});
export type FLKontoSitzEinwilligung = z.infer<typeof FLKontoSitzEinwilligungSchema>;

/**
 * Mirrors `FLKontoEinwilligungenResponse`, the account page's one read of every confirmed consent the
 * address holds. Empty rather than refused where nothing is held: the page renders for every person.
 */
export const FLKontoEinwilligungenResponseSchema = BaseAPIResponseSchema.extend({
  spieler: FLSpielerSelbstSchema.nullable(),
  schiedsrichter: z.array(FLSchiedsrichterSelbstSchema),
  sitze: z.array(FLKontoSitzEinwilligungSchema),
});
export type FLKontoEinwilligungenResponse = z.infer<typeof FLKontoEinwilligungenResponseSchema>;
