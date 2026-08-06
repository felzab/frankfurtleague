/**
 * SPIELE · cached reads
 *
 * The list read and the single read, both tagged and both invalidated by `actions.ts` in this same
 * slice, which is the pairing that keeps invalidation honest.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Every granular tag declared here has a matching `updateTag` in `actions.ts`. A tag nothing
 *     invalidates is not a caching strategy — it is decoration that reads like coverage.
 *   • Omitting `saison_id` means the current season, not all seasons. The backend resolves it, so the
 *     most common cache entries carry only the base tag.
 *   • The single read declares the base tag ONLY. A match write resolves the whole season's bracket and
 *     rewrites fixtures the request never named (ADR-0042), so no narrower tag describes it.
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/frontend/spec.md — section 4, the full cache-tag design
 */

import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";

import { FLSpieleListResponseSchema, FLSpieleSingleResponseSchema } from "./schemas";

import type { FLSpieleListResponse, FLSpieleSingleResponse } from "./schemas";
import type { FLSpieleFilterParams } from "./types";

export async function getSpiele(filters: FLSpieleFilterParams = {}): Promise<FLSpieleListResponse> {
  "use cache";

  // The only granular tag kept for this resource (ADR-0001): the admin patch action invalidates it
  // by season. No tags by phase or status: a result edit *changes* a match's status, so invalidating
  // by status would need both the previous and the new value to be correct.
  const tags: string[] = ["spiele"];
  if (filters.saison_id) tags.push(`spiele:saison_id:${filters.saison_id}`);
  cacheTag(...tags);
  cacheLife("hours");

  return apiClient("/spiele", FLSpieleListResponseSchema, {
    params: filters,
  });
}

/**
 * One match by its id, for the edit page whose subject IS that match (ADR-0050).
 *
 * **UNCACHED, and deliberately (ADR-0054).**
 * It is the only read in this module without `"use cache"`, and it is the second uncached read in the
 * app after `getAdminSpieleActionRequired`, for the same first reason: this is admin-authorized data
 * behind a session, so it does not belong in a cache shared across requests, and the surface that
 * edits a fixture is the last place a stale copy is acceptable.
 *
 * The reason it stopped being cached is narrower and is what forced the change. A cached entry here
 * had to carry the `spiele` tag, which every match write invalidates — and under `cacheComponents`
 * that revalidation re-renders a dynamic segment holding both a postponed state and fallback params
 * (ADR-0011 rules out `generateStaticParams`, so the App Shell is built with placeholders). Next
 * asserts that combination is impossible, and the resulting crash truncated the response of whatever
 * server action triggered the revalidation — so the undo reported "An unexpected response was received
 * from the server" while its write never reached the backend. With nothing tagged on this route, the
 * revalidation has nothing to re-render and the invariant is unreachable.
 *
 * The cost is one backend round-trip per opening of the edit page, paid by one admin.
 *
 * Throws `APIBadStatusError` with `statusCode: 404` when the id matches no match — the edit page catches
 * exactly that and rethrows everything else, so a backend outage never reads as a missing fixture.
 */
export async function getSpiel(spielId: string): Promise<FLSpieleSingleResponse> {
  return apiClient(`/spiele/${spielId}`, FLSpieleSingleResponseSchema);
}
