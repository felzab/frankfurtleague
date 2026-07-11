import { apiClient } from "@/core/api";

import { FLPostSpielortResponseSchema } from "./schemas";

import type { FLNewSpielortPayload, FLPostSpielortResponse } from "./schemas";

export async function postSpielort(newSpielortPayload: FLNewSpielortPayload): Promise<FLPostSpielortResponse> {
  return apiClient<FLPostSpielortResponse>("/admin/post_spielort", FLPostSpielortResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(newSpielortPayload),
  });
}
