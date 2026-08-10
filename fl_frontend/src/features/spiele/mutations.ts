/**
 * SPIELE · backend write call
 *
 * Thin transport between the server action and FastAPI. No authorization and no cache handling
 * here — both belong to `actions.ts`, the only caller.
 *
 * Invariants:
 * - `authType: "admin"` — the backend's admin router rejects the base key.
 * - The payload is sent whole: the backend writes it back with `$set`.
 * - `spiel_id` goes in the path and never in the body (ADR-0027); this is where it is split off.
 * - The response parses with its OWN schema — `strip` mode would drop the advanced fixtures (ADR-0034).
 *
 * See:
 * - docs/backend/spec.md — section 1.3, what the endpoint does with this payload
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

/**
 * The same call with `dry_run=true`: the backend reports what saving this payload would move and
 * destroy, and writes nothing (ADR-0041).
 *
 * **Deliberately the same endpoint, the same payload and the same response schema.** A preview built
 * as its own endpoint would be a second implementation of the write path's normalisation and refusal
 * rules, and the day the two disagreed the warning would name the wrong fixtures — which is worse than
 * showing none, because an admin who has learned to trust it will not check.
 */
export const previewAdminSpielData = async ({ spiel_id, ...fields }: FLPatchSpielDataPayload): Promise<FLPatchSpielDataResponse> => {
  return apiClient<FLPatchSpielDataResponse>(`/spiele/${spiel_id}?dry_run=true`, FLPatchSpielDataResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(fields),
  });
};
