import { apiClient } from "@/core/api";

import { FLPostSpielortResponseSchema } from "./schemas";

import type { FLPostSpielortPayload, FLPostSpielortResponse } from "./schemas";

export async function postSpielort(postSpielortPayload: FLPostSpielortPayload): Promise<FLPostSpielortResponse> {
  return apiClient<FLPostSpielortResponse>("/admin/post_spielort", FLPostSpielortResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(postSpielortPayload),
  });
}
