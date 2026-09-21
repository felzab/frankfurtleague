import { apiClient } from "@/core/api";

import { FLPostSperrlisteResponseSchema, FLSperrlisteWriteResponseSchema } from "./schemas";

import type { FLPostSperrlistePayload, FLPostSperrlisteResponse, FLSperrlisteKeyPayload, FLSperrlisteWriteResponse } from "./schemas";

export async function postSperre(postSperrePayload: FLPostSperrlistePayload): Promise<FLPostSperrlisteResponse> {
  return apiClient<FLPostSperrlisteResponse>("/sperrliste", FLPostSperrlisteResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(postSperrePayload),
  });
}

// Hard, unlike every other DELETE in the admin: a ban holds nothing to retire, so the row goes.
export async function deleteSperre({ id }: FLSperrlisteKeyPayload): Promise<FLSperrlisteWriteResponse> {
  return apiClient<FLSperrlisteWriteResponse>(`/sperrliste/${id}`, FLSperrlisteWriteResponseSchema, {
    method: "DELETE",
    authType: "admin",
  });
}
