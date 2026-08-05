/**
 * ADMIN · action-required query
 *
 * The one query in the codebase that is deliberately NOT cached.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • No `"use cache"`, on purpose. This returns admin-authorized data, which has no business in a
 *     cache shared across every visitor. Do not "fix" the inconsistency by adding one.
 *   • Being uncached is exactly what lets it run inside `runWithIncomingCorrelationId`, so its
 *     backend call carries the id the edge minted for the page request rather than one of its own.
 *     Adding `"use cache"` would make that call throw rather than fail quietly (docs/logging.md).
 *   • `authType: "admin"` — the backend's admin router rejects the base key.
 *   • It reads a Spiel schema from the `spiele` slice rather than redeclaring one. `admin` is an
 *     aggregator: importing across slices is what it is for.
 *   • The response carries `bracket_faults` beside the matches, derived per request by the backend
 *     (ADR-0047). It is not a list this side can compute: a fault is a contradiction between documents
 *     of a whole season, and this route returns a filtered handful of them.
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/frontend/spec.md — section 2
 */

import { apiClient } from "@/core/api";
import { runWithIncomingCorrelationId } from "@/shared/utils/correlationScope";

import { FLSpieleActionRequiredResponseSchema } from "../spiele/schemas";

import type { FLSpieleActionRequiredResponse } from "../spiele/schemas";

export const getAdminSpieleActionRequired = async (): Promise<FLSpieleActionRequiredResponse> => {
  return runWithIncomingCorrelationId(() =>
    apiClient<FLSpieleActionRequiredResponse>("/spiele/action_required", FLSpieleActionRequiredResponseSchema, { authType: "admin" }),
  );
};
