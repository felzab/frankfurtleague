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
// `cache` memoizes per RENDER PASS, never `"use cache"`, which keys on the arguments.
export const getAdminSaisons = cache(async (): Promise<FLSaisonsAdminListResponse> => runAdminRead(() => saisonsGetSaisonsAdmin()));

/**
 * What the season editor shows, in its one read: the season, its clubs graded as its swap and replacement judge them,
 * the clubs a replacement may bring in, and the shapes its draw admits; `null` where no season holds the id.
 */
// `cache` memoizes per RENDER PASS, so the tab's title and the page read it once.
export const getAdminSaison = cache(async (saisonId: string): Promise<FLSaisonAdminResponse | null> =>
  runAdminRead(() => orMissing(saisonsGetSaisonAdmin(saisonId))),
);

/** Whether the public may read `saisonId`'s pages, as the season pages' frame lists them: a planned season it may not. */
export async function isPublicSaison(saisonId: string): Promise<boolean> {
  return (await getSaisonFrame()).saisons.some((saison) => saison.id === saisonId);
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
