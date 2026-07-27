import { CustomObjectIdStringSchema, FLAddressSchema } from "@/shared/schemas";
import z from "zod";

import { BaseAPIResponseSchema } from "@/core/api";

export const FLPostSpielortPayloadSchema = z.object({
  name: z.string().nonempty(),
  default_mietpreis: z.int().nonnegative(),
  address: FLAddressSchema,
});
export type FLPostSpielortPayload = z.infer<typeof FLPostSpielortPayloadSchema>;

export const FLPatchSpielortPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  name: z.string().nonempty(),
  default_mietpreis: z.int().nonnegative(),
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
  is_inactive: z.boolean(),
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
