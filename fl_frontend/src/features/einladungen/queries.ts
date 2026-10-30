import { cache } from "react";

import { saisonsGetEinladungenVersandVorschau, teamsGetEinladung } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLEinladungResponse, FLEinladungVersandVorschauResponse } from "@/core/generated/client/types";

/**
 * **Never `"use cache"` here**: `laeuft` is judged against today, so a cached answer would go on
 * reporting an open window long after it shut.
 */
// `cache` memoizes per RENDER PASS.
export const getEinladung = cache(async (teamId: string, saisonId: string): Promise<FLEinladungResponse> =>
  runAdminRead(() => teamsGetEinladung(teamId, saisonId)),
);

/**
 * **`erneut` rides along**: a team already mailed reads as skipped with it false and is written to
 * with it true, so a list read without the value the press will carry describes a different press.
 */
export async function getEinladungVersandVorschau(saisonId: string, erneut: boolean): Promise<FLEinladungVersandVorschauResponse> {
  return runAdminRead(() => saisonsGetEinladungenVersandVorschau(saisonId, { erneut: erneut }));
}
