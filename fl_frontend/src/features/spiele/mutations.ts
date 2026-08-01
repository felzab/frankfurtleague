/**
 * SPIELE · backend write call
 *
 * Thin transport between the server action and FastAPI. No authorization and no cache handling here —
 * both belong to `actions.ts`, which is the only caller.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • `authType: "admin"` selects the admin bearer key. The backend's admin router rejects the base
 *     key, so this is not interchangeable with a default call.
 *   • The payload is sent whole. The backend writes it back with `$set`, so an omitted field is
 *     overwritten rather than preserved.
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/backend/spec.md — section 3, what the endpoint does with this payload
 */

import { apiClient } from "@/core/api";
import { BaseAPIResponseSchema } from "@/core/schemas";

import type { BaseAPIResponse } from "@/core/schemas";
import type { FLPatchSpielDataPayload } from "./schemas";

export const patchAdminSpielData = async (formData: FLPatchSpielDataPayload): Promise<BaseAPIResponse> => {
  return apiClient<BaseAPIResponse>("/admin/update_spiel_data", BaseAPIResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(formData),
  });
};
