import { CustomObjectIdStringSchema, FLAddressSchema } from "@/shared/schemas";
import z from "zod";

import { BaseAPIResponseSchema } from "@/core/api";

export const FLNewSpielortPayloadSchema = z.object({
  name: z.string().nonempty(),
  default_mietpreis: z.int().nonnegative(),
  address: FLAddressSchema,
});
export type FLNewSpielortPayload = z.infer<typeof FLNewSpielortPayloadSchema>;

export const FLSpielortSchema = z.object({
  id: CustomObjectIdStringSchema,

  address: FLAddressSchema,
  name: z.string().nonempty(),
  maps_link: z.string().nonempty(),
  default_mietpreis: z.int().nonnegative(),
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
