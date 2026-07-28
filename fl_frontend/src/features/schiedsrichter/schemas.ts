import { CustomObjectIdStringSchema, FLKontaktSchema } from "@/shared/schemas";
import z from "zod";

import { BaseAPIResponseSchema } from "@/core/api";

export const FLPostSchiedsrichterPayloadSchema = z.object({
  name: z.string().nonempty(),
  default_payment: z.int().nonnegative(),
  kontakt: FLKontaktSchema,
  schule: z.string().nullable(),
});
export type FLPostSchiedsrichterPayload = z.infer<typeof FLPostSchiedsrichterPayloadSchema>;

export const FLPatchSchiedsrichterPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  name: z.string().nonempty(),
  default_payment: z.int().nonnegative(),
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
  is_inactive: z.boolean(),
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
