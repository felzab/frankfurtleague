import { cache } from "react";

import { apiClient } from "@/core/api";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import { FLEinladungResponseSchema, FLEinladungVersandVorschauResponseSchema } from "./schemas";

import type { FLEinladungResponse, FLEinladungVersandVorschauResponse } from "./schemas";

/**
 * **Never `"use cache"` here** (`.claude/rules/frontend.md`'s **cache** clause): `laeuft` is judged
 * against today, so a cached answer would go on reporting an open window long after it shut.
 */
// `cache` memoizes per RENDER PASS (`docs/frontend/spec.md` §1.2).
export const getEinladung = cache(async (teamId: string, saisonId: string): Promise<FLEinladungResponse> =>
  runWithIncomingTrace(() =>
    apiClient<FLEinladungResponse>(
      `/teams/${encodeURIComponent(teamId)}/saisons/${encodeURIComponent(saisonId)}/einladung`,
      FLEinladungResponseSchema,
      { authType: "admin" },
    ),
  ),
);

/**
 * **`erneut` rides along**: a team already mailed reads as skipped with it false and is written to
 * with it true, so a list read without the value the press will carry describes a different press.
 */
export async function getEinladungVersandVorschau(saisonId: string, erneut: boolean): Promise<FLEinladungVersandVorschauResponse> {
  return runWithIncomingTrace(() =>
    apiClient<FLEinladungVersandVorschauResponse>(
      `/saisons/${encodeURIComponent(saisonId)}/einladungen/versand/vorschau?erneut=${erneut ? "true" : "false"}`,
      FLEinladungVersandVorschauResponseSchema,
      { authType: "admin" },
    ),
  );
}
