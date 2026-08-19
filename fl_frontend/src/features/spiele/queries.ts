import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";
import { APIBadStatusError } from "@/core/errors";

import { FLSpieleListResponseSchema, FLSpieleSingleResponseSchema } from "./schemas";

import type { FLSpieleListResponse, FLSpieleSingleResponse } from "./schemas";
import type { FLSpieleFilterParams } from "./types";

export async function getSpiele(filters: FLSpieleFilterParams = {}): Promise<FLSpieleListResponse> {
  "use cache";

  // The only granular tag, and `actions.ts` has its matching `updateTag`. None by phase or status:
  // a result edit changes a match's status, so both the old and new value would have to invalidate.
  const tags: string[] = ["spiele"];
  if (filters.saison_id) tags.push(`spiele:saison_id:${filters.saison_id}`);
  cacheTag(...tags);
  cacheLife("hours");

  return apiClient("/spiele", FLSpieleListResponseSchema, {
    params: filters,
  });
}

/**
 * **The base tag alone, and not by oversight**: a bracket-resolving patch rewrites *other* fixtures
 * of the season, so nothing narrower describes what one match write invalidates.
 */
export async function getSpiel(spielId: string): Promise<FLSpieleSingleResponse | null> {
  "use cache";

  cacheTag("spiele");
  cacheLife("hours");

  // The 404 becomes `null` INSIDE this function: an error thrown out of a `"use cache"` scope
  // reaches the caller redacted to a digest in a production build, leaving no `statusCode` to read.
  return apiClient(`/spiele/${spielId}`, FLSpieleSingleResponseSchema).catch((error: unknown) => {
    if (error instanceof APIBadStatusError && error.statusCode === 404) return null;
    throw error;
  });
}
