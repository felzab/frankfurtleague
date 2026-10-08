import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { FLKontaktRolleSchema } from "@/features/bewerbungen/schemas";
import { CustomObjectIdStringSchema } from "@/shared/schemas";

/**
 * One seat as a seat holder reads it: who holds it and whether they confirmed. No address, telephone or
 * date at any depth, for any seat: a contact person was promised only administrators see their details.
 */
export const FLTeamSitzSchema = z.object({
  rolle: FLKontaktRolleSchema,
  // `null` is an empty slot, which the landing names rather than omits.
  name: z.string().nullable(),
  bestaetigt: z.boolean(),
});
export type FLTeamSitz = z.infer<typeof FLTeamSitzSchema>;

export const FLTeamSitzeResponseSchema = BaseAPIResponseSchema.extend({
  team_id: CustomObjectIdStringSchema,
  saison_id: z.string(),
  sitze: z.array(FLTeamSitzSchema),
});
export type FLTeamSitzeResponse = z.infer<typeof FLTeamSitzeResponseSchema>;
