import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";
import { isRecordMissing } from "@/core/errors";
import { SITE_CACHE_TAG } from "@/core/siteCache";
import { runAdminRead } from "@/shared/utils/adminRead";

import { FLLoeschungVorschauResponseSchema, FLSaisonsListResponseSchema, FLSaisonsSingleResponseSchema } from "./schemas";

import type { FLLoeschungVorschauResponse, FLSaisonsListResponse, FLSaisonsSingleResponse } from "./schemas";
import type { FLSaisonsFilterParams } from "./types";

export async function getSaisons(filters: FLSaisonsFilterParams = {}): Promise<FLSaisonsListResponse> {
  "use cache";

  cacheTag(SITE_CACHE_TAG);
  cacheLife("minutes");

  return apiClient<FLSaisonsListResponse>("/saisons", FLSaisonsListResponseSchema, {
    params: filters,
    cacheFill: { name: "getSaisons", args: filters },
  });
}

/**
 * Every season, the planned ones `getSaisons` withholds included. A club is entered into a season
 * only while it is still planned, so an admin surface that cannot see one cannot run the league.
 */
// `cache` memoizes per RENDER PASS, never `"use cache"`, which keys on the arguments.
export const getAdminSaisons = cache(async (): Promise<FLSaisonsListResponse> =>
  runAdminRead(() => apiClient<FLSaisonsListResponse>("/saisons/list/admin", FLSaisonsListResponseSchema, { authType: "admin" })),
);

/**
 * Whom activating `saisonId` would delete, on the statuses that activation leaves. Read afresh on every
 * render: a count from before another season's activation names people who are already gone.
 */
export async function getLoeschungVorschau(saisonId: string): Promise<FLLoeschungVorschauResponse> {
  return runAdminRead(() =>
    apiClient<FLLoeschungVorschauResponse>(`/saisons/${encodeURIComponent(saisonId)}/loeschung/vorschau`, FLLoeschungVorschauResponseSchema, {
      authType: "admin",
    }),
  );
}

/**
 * `null` where no season is marked active: the backend answers that with a 404 rather than an
 * empty body (`fl_backend/app/api/saisons/crud.py :: pull_current_saison`). A stored absence
 * clears on the next season write, which every activation is.
 */
export async function getCurrentSaisonOrNull(): Promise<FLSaisonsSingleResponse | null> {
  "use cache";

  cacheTag(SITE_CACHE_TAG);
  cacheLife("minutes");

  return apiClient<FLSaisonsSingleResponse>("/saisons/current", FLSaisonsSingleResponseSchema, {
    cacheFill: { name: "getCurrentSaisonOrNull", args: {} },
  }).catch((error: unknown) => {
    // Inside the cache scope: an error thrown out of one reaches the caller redacted to a digest,
    // so a catch at the call site cannot recognise it
    // (`fl_frontend/src/features/teams/queries.ts :: getTeam`).
    if (isRecordMissing(error)) return null;
    throw error;
  });
}
