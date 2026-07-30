import { CustomObjectIdStringSchema } from "@/shared/schemas";
import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";

// Mirrors the backend FLSpieler. Only vorname is mandatory; the rest may legitimately be absent
// for a player whose squad entry has not been filled in yet. The backend already declared these
// nullable — the frontend did not, so a null would have thrown APIMalformedDataError.
export const FLSpielerSchema = z.object({
  id: CustomObjectIdStringSchema,
  vorname: z.string(),
  nachname: z.string().nullable(),
  stufe: z.string().nullable(),
  nummer: z.string().nullable(),
  position: z.string().nullable(),
  is_nachgetragen: z.boolean(),
  team_id: CustomObjectIdStringSchema,
});
export type FLSpieler = z.infer<typeof FLSpielerSchema>;

export const FLSpielerListResponseSchema = BaseAPIResponseSchema.extend({
  spieler: z.array(FLSpielerSchema),
});
export type FLSpielerListResponse = z.infer<typeof FLSpielerListResponseSchema>;
