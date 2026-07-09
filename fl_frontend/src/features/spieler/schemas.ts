import { CustomObjectIdStringSchema } from "@/shared/schemas";
import z from "zod";

import { BaseAPIResponseSchema } from "@/core/api";

export const FLSpielerSchema = z.object({
  id: CustomObjectIdStringSchema,
  vorname: z.string(),
  nachname: z.string(),
  stufe: z.string(),
  nummer: z.string().nullable(),
  position: z.string(),
  is_nachgetragen: z.boolean(),
  team_id: CustomObjectIdStringSchema,
});
export type FLSpieler = z.infer<typeof FLSpielerSchema>;

export const FLSpielerListResponseSchema = BaseAPIResponseSchema.extend({
  spieler: z.array(FLSpielerSchema),
});
export type FLSpielerListResponse = z.infer<typeof FLSpielerListResponseSchema>;
