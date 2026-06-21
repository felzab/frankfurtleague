import { CustomObjectIdStringSchema, FLKontaktSchema } from "@/shared/schemas";
import z from "zod";

import { BaseAPIResponseSchema } from "@/core/api";

export const FLSchiedsrichterSchema = z.object({
  id: CustomObjectIdStringSchema,

  name: z.string().nonempty(),
  schule: z.string().nullable(),
  default_payment: z.int().nonnegative(),
  kontakt: FLKontaktSchema,
});
export type FLSchiedsrichter = z.infer<typeof FLSchiedsrichterSchema>;

export const FLSchiedsrichterListResponseSchema = BaseAPIResponseSchema.extend({
  schiedsrichter: z.array(FLSchiedsrichterSchema),
});
export type FLSchiedsrichterListResponse = z.infer<typeof FLSchiedsrichterListResponseSchema>;
