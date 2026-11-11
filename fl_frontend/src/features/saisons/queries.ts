import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";

import { orMissing } from "@/core/errors";
import {
  saisonsGetFrame,
  saisonsGetKoRunde,
  saisonsGetSaisonAdmin,
  saisonsGetSaisonsAdmin,
  saisonsGetSpiel,
  saisonsGetSpielplan,
  saisonsGetTabelle,
  saisonsGetTeam,
  saisonsGetTeams,
} from "@/core/generated/client/sdk";
import { SITE_CACHE_TAG } from "@/core/siteCache";
import { runAdminRead } from "@/shared/utils/adminRead";

import type {
  FLKoRundeResponse,
  FLSaisonAdminResponse,
  FLSaisonFrameResponse,
  FLSaisonsAdminListResponse,
  FLSaisonTeamsResponse,
  FLSpielPageResponse,
  FLSpielplanResponse,
  FLTabelleResponse,
  FLTeamPageResponse,
} from "@/core/generated/client/types";

/**
 * Every season, the planned ones every base-tier read withholds included, oldest first by id. A club is entered into a
 * season only while it is still planned, so an admin surface that cannot see one cannot run the league.
 */
// `cache` memoizes per render pass. Never `"use cache"`, which keys on the arguments rather than the caller.
export const getAdminSaisons = cache(async (): Promise<FLSaisonsAdminListResponse> => runAdminRead(() => saisonsGetSaisonsAdmin()));

/** `null` where no season holds the id. */
// `cache` memoizes per render pass, so the tab's title and the page read it once.
export const getAdminSaison = cache(async (saisonId: string): Promise<FLSaisonAdminResponse | null> =>
  runAdminRead(() => orMissing(saisonsGetSaisonAdmin(saisonId))),
);

/** Judged against the season pages' frame: a planned season the public may not read. */
export async function isPublicSaison(saisonId: string): Promise<boolean> {
  return (await getSaisonFrame()).saisons.some((saison) => saison.id === saisonId);
}

/** Every season the public may read, the newest first. */
export async function getSaisonFrame(): Promise<FLSaisonFrameResponse> {
  "use cache";

  cacheTag(SITE_CACHE_TAG);
  cacheLife("minutes");

  return saisonsGetFrame();
}

export async function getSpielplan(saisonId: string): Promise<FLSpielplanResponse | null> {
  "use cache";

  cacheTag(SITE_CACHE_TAG);
  cacheLife("minutes");

  return orMissing(saisonsGetSpielplan(saisonId));
}

/** None before the draw. */
export async function getKoRunde(saisonId: string): Promise<FLKoRundeResponse | null> {
  "use cache";

  cacheTag(SITE_CACHE_TAG);
  cacheLife("minutes");

  return orMissing(saisonsGetKoRunde(saisonId));
}

/** Places as the backend numbers them. */
export async function getTabelle(saisonId: string): Promise<FLTabelleResponse | null> {
  "use cache";

  cacheTag(SITE_CACHE_TAG);
  cacheLife("minutes");

  return orMissing(saisonsGetTabelle(saisonId));
}

export async function getSaisonTeams(saisonId: string): Promise<FLSaisonTeamsResponse | null> {
  "use cache";

  cacheTag(SITE_CACHE_TAG);
  cacheLife("minutes");

  return orMissing(saisonsGetTeams(saisonId));
}

export async function getTeamPage(saisonId: string, teamId: string): Promise<FLTeamPageResponse | null> {
  "use cache";

  cacheTag(SITE_CACHE_TAG);
  cacheLife("minutes");

  return orMissing(saisonsGetTeam(saisonId, teamId));
}

export async function getSpielPage(saisonId: string, spielId: string): Promise<FLSpielPageResponse | null> {
  "use cache";

  cacheTag(SITE_CACHE_TAG);
  cacheLife("minutes");

  return orMissing(saisonsGetSpiel(saisonId, spielId));
}
