import { cache } from "react";

import { apiClient } from "@/core/api";
import { runAdminRead } from "@/shared/utils/adminRead";
import { runPersonRead } from "@/shared/utils/personRead";

import {
  FLSpielberichtAdminResponseSchema,
  FLSpielberichtePersonResponseSchema,
  FLSpielberichteSaisonResponseSchema,
  FLSpielberichtSchiedsrichterResponseSchema,
} from "./schemas";

import type {
  FLSpielberichtAdminResponse,
  FLSpielberichtePersonResponse,
  FLSpielberichteSaisonResponse,
  FLSpielberichtSchiedsrichterResponse,
} from "./schemas";

/**
 * One fixture's report as the administrator reads it, remarks and reasons included, with its state. Uncached: an
 * admin-tier read.
 */
export async function getAdminSpielbericht(spielId: string): Promise<FLSpielberichtAdminResponse> {
  return runAdminRead(() =>
    apiClient<FLSpielberichtAdminResponse>(`/spielberichte/${spielId}/admin`, FLSpielberichtAdminResponseSchema, { authType: "admin" }),
  );
}

/** Every report of a season holding a block, each with its state: what the triage and the cards read. */
export async function getSpielberichteZustaende(saisonId: string): Promise<FLSpielberichteSaisonResponse> {
  return runAdminRead(() =>
    apiClient<FLSpielberichteSaisonResponse>("/spielberichte", FLSpielberichteSaisonResponseSchema, {
      authType: "admin",
      params: { saison_id: saisonId },
    }),
  );
}

/** What the booked referee's form opens on; refused `REQ-BERICHT-002` once the fixture is booked to somebody else. */
export async function getSchiedsrichterSpielbericht(spielId: string): Promise<FLSpielberichtSchiedsrichterResponse> {
  return runPersonRead(() =>
    apiClient<FLSpielberichtSchiedsrichterResponse>(`/spielberichte/${spielId}/bericht`, FLSpielberichtSchiedsrichterResponseSchema, {
      authType: "admin",
    }),
  );
}

/** The played fixtures booked to the signed-in referee, the panel's list. */
export const getSchiedsrichterSpielberichte = cache(async (): Promise<FLSpielberichtePersonResponse> =>
  runPersonRead(() =>
    apiClient<FLSpielberichtePersonResponse>("/spielberichte/person", FLSpielberichtePersonResponseSchema, { authType: "admin" }),
  ),
);
