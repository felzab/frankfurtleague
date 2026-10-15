import { apiClient } from "@/core/api";
import { FLErasureResponseSchema } from "@/core/schemas";

import type { FLErasureResponse } from "@/core/schemas";

/**
 * Erases every league record of the person the request's actor names, the actor and nothing in the body
 * saying whom: the press reaches the library's account deletion only once this has answered.
 */
export async function eraseEigeneDaten(): Promise<FLErasureResponse> {
  return apiClient<FLErasureResponse>("/identitaet/selbst/erasure", FLErasureResponseSchema, { method: "POST", authType: "admin" });
}
