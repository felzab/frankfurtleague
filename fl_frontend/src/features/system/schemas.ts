import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";

export const CheckIsLiveReturnSchema = BaseAPIResponseSchema.extend({
  status: z.literal("ok"),
});
export type CheckIsLiveReturn = z.infer<typeof CheckIsLiveReturnSchema>;

export const CheckIsReadyReturnSchema = BaseAPIResponseSchema.extend({
  status: z.literal("ok"),
});
export type CheckIsReadyReturn = z.infer<typeof CheckIsReadyReturnSchema>;

export const GetSystemInfoReturnSchema = BaseAPIResponseSchema.extend({
  // A number, not a string: backend_config.api_version is `int` and serialises as a JSON number.
  // This was z.string().nonempty(), which could never have matched. nonnegative, not positive --
  // the current API version is 0, which is why the routes are mounted at /api/v0.
  api_version: z.int().nonnegative(),
});
export type GetSystemInfoReturn = z.infer<typeof GetSystemInfoReturnSchema>;
