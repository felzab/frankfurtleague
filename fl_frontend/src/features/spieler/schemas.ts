/**
 * SPIELER · models
 *
 * Mirrors `fl_backend/app/api/spieler/schemas.py`.
 *
 * Only `vorname` is mandatory. The rest may legitimately be absent for a squad entry that has not been
 * filled in — and the nullability here is not cosmetic: the backend already declared these fields
 * nullable while this schema did not, so a real null threw `APIMalformedDataError` on a valid response.
 *
 * `nummer` is a STRING, not an int.
 */

import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { CustomDateStringSchema, CustomObjectIdStringSchema } from "@/shared/schemas";

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
  // The day this player left the club, null while they are on a squad (ADR-0032). Declared because
  // the backend sends it: zod's default strip mode discards an undeclared field with no error.
  inactive_since: CustomDateStringSchema.nullable(),
});
export type FLSpieler = z.infer<typeof FLSpielerSchema>;

export const FLSpielerListResponseSchema = BaseAPIResponseSchema.extend({
  spieler: z.array(FLSpielerSchema),
});
export type FLSpielerListResponse = z.infer<typeof FLSpielerListResponseSchema>;
