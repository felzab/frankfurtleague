/**
 * ADMIN · action-required query
 *
 * The one query in the codebase that is deliberately NOT cached: it returns admin-authorized
 * data, which has no business in a cache shared across every visitor (ADR-0013). Do not "fix"
 * the inconsistency by adding `"use cache"`.
 *
 * Invariants:
 * - Being uncached is what lets it run inside `runWithIncomingCorrelationId` (docs/logging.md).
 * - `authType: "admin"` — the backend's admin router rejects the base key.
 * - It reads the `spiele` slice's Spiel schema: `admin` is an aggregator, importing across slices.
 * - `bracket_faults` is derived per request by the backend (ADR-0047) — a fault spans a whole
 *   season's documents, never computable from this filtered handful.
 *
 * See:
 * - docs/frontend/spec.md — section 2
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
