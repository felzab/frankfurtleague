import { apiClient } from "@/core/api";
import { FLSelbstErasureResponseSchema } from "@/core/schemas";

import type { FLSelbstErasureResponse } from "@/core/schemas";

/**
 * Erases every league record of the person the request's actor names, the actor and nothing in the body
 * saying whom: the press reaches the library's account deletion only once this has answered.
 */
export async function eraseEigeneDaten(): Promise<FLSelbstErasureResponse> {
  return apiClient<FLSelbstErasureResponse>("/identitaet/selbst/erasure", FLSelbstErasureResponseSchema, { method: "POST", authType: "admin" });
}
