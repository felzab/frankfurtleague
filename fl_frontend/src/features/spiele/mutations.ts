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
 *   • `spiel_id` goes in the PATH and never in the body (ADR-0034). It stays on the payload schema
 *     because the form carries it; this is where it is split off.
 *   • The response is parsed with its OWN schema, not with `BaseAPIResponseSchema`. The endpoint
 *     reports the bracket fixtures it advanced, and zod's `strip` mode discards a field no schema
 *     declares without saying so — the envelope alone would silently drop it (ADR-0042).
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/backend/spec.md — section 3, what the endpoint does with this payload
 */

import { apiClient } from "@/core/api";

import { FLPatchSpielDataResponseSchema } from "./schemas";

import type { FLPatchSpielDataPayload, FLPatchSpielDataResponse } from "./schemas";

export const patchAdminSpielData = async ({ spiel_id, ...fields }: FLPatchSpielDataPayload): Promise<FLPatchSpielDataResponse> => {
  return apiClient<FLPatchSpielDataResponse>(`/spiele/${spiel_id}`, FLPatchSpielDataResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(fields),
  });
};
