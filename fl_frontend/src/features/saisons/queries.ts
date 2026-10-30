import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";

import { isRecordMissing } from "@/core/errors";
import {
  saisonsGetActiveSaison,
  saisonsGetLoeschungVorschau,
  saisonsGetSaisons,
  saisonsGetSaisonsVerwaltung,
} from "@/core/generated/client/sdk";
import { SITE_CACHE_TAG } from "@/core/siteCache";
import { runAdminRead } from "@/shared/utils/adminRead";

import type {
  FLLoeschungVorschauResponse,
  FLSaisonsAdminListResponse,
  FLSaisonsListResponse,
  FLSaisonsSingleResponse,
  SaisonsGetSaisonsParams,
} from "@/core/generated/client/types";

export async function getSaisons(filters: SaisonsGetSaisonsParams = {}): Promise<FLSaisonsListResponse> {
  "use cache";

  cacheTag(SITE_CACHE_TAG);
  cacheLife("minutes");

  return saisonsGetSaisons(filters);
}

/**
 * Every season, the planned ones `getSaisons` withholds included. A club is entered into a season
 * only while it is still planned, so an admin surface that cannot see one cannot run the league.
 */
// `cache` memoizes per RENDER PASS, never `"use cache"`, which keys on the arguments.
export const getAdminSaisons = cache(async (): Promise<FLSaisonsAdminListResponse> => runAdminRead(() => saisonsGetSaisonsVerwaltung()));

/**
 * Whom activating `saisonId` would delete, on the statuses that activation leaves. Read afresh on every
 * render: a count from before another season's activation names people who are already gone.
 */
export async function getLoeschungVorschau(saisonId: string): Promise<FLLoeschungVorschauResponse> {
  return runAdminRead(() => saisonsGetLoeschungVorschau(saisonId));
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

  return saisonsGetActiveSaison().catch((error: unknown) => {
    // Inside the cache scope: an error thrown out of one reaches the caller redacted to a digest,
    // so a catch at the call site cannot recognise it
    // (`fl_frontend/src/features/teams/queries.ts :: getTeam`).
    if (isRecordMissing(error)) return null;
    throw error;
  });
}
