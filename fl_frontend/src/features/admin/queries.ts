/**
 * ADMIN · action-required query
 *
 * The one query in the codebase that is deliberately NOT cached.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • No `"use cache"`, on purpose. This returns admin-authorized data, which has no business in a
 *     cache shared across every visitor. Do not "fix" the inconsistency by adding one.
 *   • `authType: "admin"` — the backend's admin router rejects the base key.
 *   • It reads a Spiel schema from the `spiele` slice rather than redeclaring one. `admin` is an
 *     aggregator: importing across slices is what it is for.
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/frontend/spec.md — section 2
 */

import { apiClient } from "@/core/api";

import { FLSpieleListResponseSchema } from "../spiele/schemas";

import type { FLSpieleListResponse } from "../spiele/schemas";

export const getAdminSpieleActionRequired = async (): Promise<FLSpieleListResponse> => {
  return apiClient<FLSpieleListResponse>("/admin/action_required", FLSpieleListResponseSchema, { authType: "admin" });
};
