import { cache } from "react";

import { teamsGetTeamSaisons, teamsGetTeamsVerwaltung } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type {
  FLTeamsGroupedResponse,
  FLTeamsListResponse,
  FLTeamsSaisonsResponse,
  TeamsGetTeamsVerwaltungParams,
} from "@/core/generated/client/types";

/** The list read's two shapes, told apart by `format`: `in_gruppen` asks for the grouped one. */
type FLTeamsResponse = FLTeamsListResponse | FLTeamsGroupedResponse;

/** One in-flight admin club read per filter set, held for the length of one render pass. */
const adminTeamsInFlight = cache((): Map<string, Promise<FLTeamsResponse>> => new Map());

/**
 * A season's clubs for the admin surfaces, a planned season's included — the public read refuses that
 * season, though a club is entered into one while planned. **Uncached**.
 */
export function getAdminTeams(filters: TeamsGetTeamsVerwaltungParams = {}): Promise<FLTeamsResponse> {
  // Keyed on the filters SERIALIZED, for the reason `fl_frontend/src/features/spiele/queries.ts :: getAdminSpiele` gives.
  const key = JSON.stringify(filters, Object.keys(filters).sort());
  const held = adminTeamsInFlight().get(key);
  if (held !== undefined) return held;

  const started = runAdminRead(() => teamsGetTeamsVerwaltung(filters));
  adminTeamsInFlight().set(key, started);

  return started;
}

/**
 * Every team with every membership, for the admin surfaces — the season-scoped reads cannot answer a
 * club-centric question.
 */
// Never `"use cache"` here, which keys on the arguments rather than the caller.
export const getTeamSaisons = cache(async (): Promise<FLTeamsSaisonsResponse> => runAdminRead(() => teamsGetTeamSaisons()));
