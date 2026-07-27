import { apiClient } from "@/core/api";

import { FLPostSchiedsrichterResponseSchema } from "./schemas";

import type { FLPostSchiedsrichterPayload, FLPostSchiedsrichterResponse } from "./schemas";

export async function postSchiedsrichter(postSchiedsrichterPayload: FLPostSchiedsrichterPayload): Promise<FLPostSchiedsrichterResponse> {
  return apiClient<FLPostSchiedsrichterResponse>("/admin/post_schiedsrichter", FLPostSchiedsrichterResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(postSchiedsrichterPayload),
  });
}
