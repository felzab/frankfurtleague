import z from "zod";

import { BaseAPIResponseSchema } from "@/core/api";

export const CheckIsLiveReturnSchema = BaseAPIResponseSchema.extend({
  status: z.literal("ok"),
});
export type CheckIsLiveReturn = z.infer<typeof CheckIsLiveReturnSchema>;

export const CheckIsReadyReturnSchema = BaseAPIResponseSchema.extend({
  status: z.literal("ok"),
});
export type CheckIsReadyReturn = z.infer<typeof CheckIsReadyReturnSchema>;

export const GetSystemInfoReturnSchema = BaseAPIResponseSchema.extend({
  api_version: z.string().nonempty(),
});
export type GetSystemInfoReturn = z.infer<typeof GetSystemInfoReturnSchema>;
