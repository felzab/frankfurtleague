import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";

import { isRecordMissing } from "@/core/errors";
import {
  saisonsGetActiveSaison,
  saisonsGetErasurePreview,
  saisonsGetFrame,
  saisonsGetKoRunde,
  saisonsGetSaisons,
  saisonsGetSaisonsVerwaltung,
  saisonsGetSpiel,
  saisonsGetSpielplan,
  saisonsGetTabelle,
  saisonsGetTeam,
  saisonsGetTeams,
} from "@/core/generated/client/sdk";
import { SITE_CACHE_TAG } from "@/core/siteCache";
import { runAdminRead } from "@/shared/utils/adminRead";

import type {
  FLErasurePreviewResponse,
  FLKoRundeResponse,
  FLSaisonFrameResponse,
  FLSaisonsAdminListResponse,
  FLSaisonsListResponse,
  FLSaisonsSingleResponse,
  FLSaisonTeamsResponse,
  FLSpielPageResponse,
  FLSpielplanResponse,
  FLTabelleResponse,
  FLTeamPageResponse,
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
export async function getLoeschungVorschau(saisonId: string): Promise<FLErasurePreviewResponse> {
  return runAdminRead(() => saisonsGetErasurePreview(saisonId));
}

/**
 * `null` where no season is marked active: the backend answers that with a 404 rather than an
 * empty body (`fl_backend/app/api/saisons/crud.py :: pull_active_saison`). A stored absence
 * clears on the next season write, which every activation is.
 */
export async function getActiveSaisonOrNull(): Promise<FLSaisonsSingleResponse | null> {
  "use cache";

  cacheTag(SITE_CACHE_TAG);
  cacheLife("minutes");

  return saisonsGetActiveSaison().catch((error: unknown) => {
    // Inside the cache scope: an error thrown out of one reaches the caller redacted to a digest,
    // so a catch at the call site cannot recognise it.
    if (isRecordMissing(error)) return null;
    throw error;
  });
}

/**
 * The season pages' frame: every season the public may read, the newest first, and the one the site is on,
 * `null` for a league that has none yet.
 */
export async function getSaisonFrame(): Promise<FLSaisonFrameResponse> {
  "use cache";

  cacheTag(SITE_CACHE_TAG);
  cacheLife("minutes");

  return saisonsGetFrame();
}

/**
 * A season page's one view read, `null` where the backend answers that the season, or the record it names in
 * it, is not the public's to read. Recognised inside each cache scope, as `getActiveSaisonOrNull` does.
 */
async function orMissing<T>(read: Promise<T>): Promise<T | null> {
  return read.catch((error: unknown) => {
    if (isRecordMissing(error)) return null;
    throw error;
  });
}

/** The season's matchdays with their matches and the one to open on, which the Spielplan and the Spielsuche show. */
export async function getSpielplan(saisonId: string): Promise<FLSpielplanResponse | null> {
  "use cache";

  cacheTag(SITE_CACHE_TAG);
  cacheLife("minutes");

  return orMissing(saisonsGetSpielplan(saisonId));
}

/** The season's knockout matchdays with their matches, none before the draw. */
export async function getKoRunde(saisonId: string): Promise<FLKoRundeResponse | null> {
  "use cache";

  cacheTag(SITE_CACHE_TAG);
  cacheLife("minutes");

  return orMissing(saisonsGetKoRunde(saisonId));
}

/** Each group's standing, its places as the backend numbers them. */
export async function getTabelle(saisonId: string): Promise<FLTabelleResponse | null> {
  "use cache";

  cacheTag(SITE_CACHE_TAG);
  cacheLife("minutes");

  return orMissing(saisonsGetTabelle(saisonId));
}

/** The season's clubs by name. */
export async function getSaisonTeams(saisonId: string): Promise<FLSaisonTeamsResponse | null> {
  "use cache";

  cacheTag(SITE_CACHE_TAG);
  cacheLife("minutes");

  return orMissing(saisonsGetTeams(saisonId));
}

/** One club in one season: the club, its row of the Tabelle, its matches and its squad. */
export async function getTeamPage(saisonId: string, teamId: string): Promise<FLTeamPageResponse | null> {
  "use cache";

  cacheTag(SITE_CACHE_TAG);
  cacheLife("minutes");

  return orMissing(saisonsGetTeam(saisonId, teamId));
}

/** One match as its page and its pop-up show it: each side's standing, and the public report. */
export async function getSpielPage(saisonId: string, spielId: string): Promise<FLSpielPageResponse | null> {
  "use cache";

  cacheTag(SITE_CACHE_TAG);
  cacheLife("minutes");

  return orMissing(saisonsGetSpiel(saisonId, spielId));
}
