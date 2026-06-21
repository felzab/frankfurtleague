import { BaseAPIResponseSchema } from "@/core/api";
import { CustomObjectIdStringSchema, FLAddressSchema } from "@/shared/schemas";
import z from "zod";

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
