import { apiClient } from "@/core/api";

import { FLSpieltagWriteResponseSchema } from "./schemas";

import type { FLPatchSpieltagPayload, FLSpieltagWriteResponse } from "./schemas";

// The only write a matchday takes: the season's generator owns which rounds exist and in what order,
// so the dates are all that is left to say.
export async function patchSpieltag({ id, ...fields }: FLPatchSpieltagPayload): Promise<FLSpieltagWriteResponse> {
  return apiClient<FLSpieltagWriteResponse>(`/spieltage/${id}`, FLSpieltagWriteResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(fields),
  });
}
