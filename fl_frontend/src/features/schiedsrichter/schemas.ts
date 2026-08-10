/**
 * SCHIEDSRICHTER · models
 *
 * Mirrors `fl_backend/app/api/schiedsrichter/schemas.py`.
 *
 * `default_payment` here is the referee's standard fee; the `payment` embedded on a Spiel is what was
 * agreed for that match. Changing the default does not, and should not, rewrite past matches.
 *
 * German error messages: these schemas back admin form inputs directly.
 */

import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { CustomDateStringSchema, CustomObjectIdStringSchema, FLKontaktSchema, PersonNameSchema } from "@/shared/schemas";

export const FLPostSchiedsrichterPayloadSchema = z.object({
  name: PersonNameSchema,
  default_payment: z.int({ error: "Bitte gib ein Standard-Honorar ein." }).nonnegative({ error: "Das Honorar darf nicht negativ sein." }),
  kontakt: FLKontaktSchema,
  schule: z.string().nullable(),
});
export type FLPostSchiedsrichterPayload = z.infer<typeof FLPostSchiedsrichterPayloadSchema>;

export const FLPatchSchiedsrichterPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  name: PersonNameSchema,
  default_payment: z.int({ error: "Bitte gib ein Standard-Honorar ein." }).nonnegative({ error: "Das Honorar darf nicht negativ sein." }),
  kontakt: FLKontaktSchema,
  schule: z.string().nullable(),
});
export type FLPatchSchiedsrichterPayload = z.infer<typeof FLPatchSchiedsrichterPayloadSchema>;

export const FLDeleteSchiedsrichterPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLDeleteSchiedsrichterPayload = z.infer<typeof FLDeleteSchiedsrichterPayloadSchema>;

export const FLSchiedsrichterSchema = z.object({
  id: CustomObjectIdStringSchema,

  name: z.string().nonempty(),
  schule: z.string().nullable(),
  default_payment: z.int().nonnegative(),
  kontakt: FLKontaktSchema,
  // The day the referee was retired, null while they officiate (ADR-0025). Deactivation goes through
  // DELETE, so it is on no payload.
  inactive_since: CustomDateStringSchema.nullable(),
});
export type FLSchiedsrichter = z.infer<typeof FLSchiedsrichterSchema>;

export const FLSchiedsrichterListResponseSchema = BaseAPIResponseSchema.extend({
  schiedsrichter: z.array(FLSchiedsrichterSchema),
});
export type FLSchiedsrichterListResponse = z.infer<typeof FLSchiedsrichterListResponseSchema>;

export const FLPostSchiedsrichterResponseSchema = BaseAPIResponseSchema.extend({
  created_id: CustomObjectIdStringSchema,
});
export type FLPostSchiedsrichterResponse = z.infer<typeof FLPostSchiedsrichterResponseSchema>;

export const FLPatchSchiedsrichterResponseSchema = BaseAPIResponseSchema.extend({
  updated_document: FLSchiedsrichterSchema,
});
export type FLPatchSchiedsrichterResponse = z.infer<typeof FLPatchSchiedsrichterResponseSchema>;

export const FLDeleteSchiedsrichterResponseSchema = BaseAPIResponseSchema.extend({
  updated_document: FLSchiedsrichterSchema,
});
export type FLDeleteSchiedsrichterResponse = z.infer<typeof FLDeleteSchiedsrichterResponseSchema>;
