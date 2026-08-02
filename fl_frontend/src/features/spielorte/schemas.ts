/**
 * SPIELORTE · models
 *
 * Mirrors `fl_backend/app/api/spielorte/schemas.py`.
 *
 * `maps_link` appears on the read model but on no payload: the backend derives it from name and
 * address, so a client cannot set it. Money fields carry German user-facing messages because these
 * schemas back admin form inputs directly.
 */

import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { CustomDateStringSchema, CustomObjectIdStringSchema, FLAddressSchema } from "@/shared/schemas";

export const FLPostSpielortPayloadSchema = z.object({
  name: z.string().nonempty({ error: "Bitte gib einen Namen ein." }),
  default_mietpreis: z
    .int({ error: "Bitte gib einen Standard-Mietpreis ein." })
    .nonnegative({ error: "Der Mietpreis darf nicht negativ sein." }),
  address: FLAddressSchema,
});
export type FLPostSpielortPayload = z.infer<typeof FLPostSpielortPayloadSchema>;

export const FLPatchSpielortPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  name: z.string().nonempty({ error: "Bitte gib einen Namen ein." }),
  default_mietpreis: z
    .int({ error: "Bitte gib einen Standard-Mietpreis ein." })
    .nonnegative({ error: "Der Mietpreis darf nicht negativ sein." }),
  address: FLAddressSchema,
});
export type FLPatchSpielortPayload = z.infer<typeof FLPatchSpielortPayloadSchema>;

export const FLDeleteSpielortPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLDeleteSpielortPayload = z.infer<typeof FLDeleteSpielortPayloadSchema>;

export const FLSpielortSchema = z.object({
  id: CustomObjectIdStringSchema,

  address: FLAddressSchema,
  name: z.string().nonempty(),
  maps_link: z.string().nonempty(),
  default_mietpreis: z.int().nonnegative(),
  // The day the venue was retired, null while it is in use (ADR-0032). Deactivation goes through
  // DELETE, so it is on no payload.
  inactive_since: CustomDateStringSchema.nullable(),
});
export type FLSpielort = z.infer<typeof FLSpielortSchema>;

export const FLSpielorteListResponseSchema = BaseAPIResponseSchema.extend({
  spielorte: z.array(FLSpielortSchema),
});
export type FLSpielorteListResponse = z.infer<typeof FLSpielorteListResponseSchema>;

export const FLPostSpielortResponseSchema = BaseAPIResponseSchema.extend({
  created_id: CustomObjectIdStringSchema,
});
export type FLPostSpielortResponse = z.infer<typeof FLPostSpielortResponseSchema>;

export const FLPatchSpielortResponseSchema = BaseAPIResponseSchema.extend({
  updated_document: FLSpielortSchema,
});
export type FLPatchSpielortResponse = z.infer<typeof FLPatchSpielortResponseSchema>;

export const FLDeleteSpielortResponseSchema = BaseAPIResponseSchema.extend({
  updated_document: FLSpielortSchema,
});
export type FLDeleteSpielortResponse = z.infer<typeof FLDeleteSpielortResponseSchema>;
