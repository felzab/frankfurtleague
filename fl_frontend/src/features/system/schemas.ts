/**
 * SYSTEM · models
 *
 * Mirrors `fl_backend/app/api/system/schemas.py`. `status` is a literal rather than a string: a probe
 * that could report anything other than ok would need callers to interpret it, and failure is already
 * carried by the status code.
 */

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
  // A number, not a string: `backend_config.api_version` is `int` and serialises as a JSON number.
  // `nonnegative`, not `positive` -- the current API version is 0, which is why the routes are
  // mounted at /api/v0.
  api_version: z.int().nonnegative(),
});
export type GetSystemInfoReturn = z.infer<typeof GetSystemInfoReturnSchema>;
