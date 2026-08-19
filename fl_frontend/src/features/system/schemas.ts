import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";

// A literal and not a string: a probe reporting anything but ok would need callers to interpret it,
// and failure already arrives as the status code.
export const CheckIsLiveReturnSchema = BaseAPIResponseSchema.extend({
  status: z.literal("ok"),
});
export type CheckIsLiveReturn = z.infer<typeof CheckIsLiveReturnSchema>;

export const CheckIsReadyReturnSchema = BaseAPIResponseSchema.extend({
  status: z.literal("ok"),
});
export type CheckIsReadyReturn = z.infer<typeof CheckIsReadyReturnSchema>;

export const GetSystemInfoReturnSchema = BaseAPIResponseSchema.extend({
  // `nonnegative` and not `positive`: the current API version is 0, which is why the routes mount
  // at /api/v0.
  api_version: z.int().nonnegative(),
});
export type GetSystemInfoReturn = z.infer<typeof GetSystemInfoReturnSchema>;
