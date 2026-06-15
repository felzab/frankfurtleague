import { apiClient } from "@/core/api";
import { cacheLife, cacheTag } from "next/cache";
import type {
  GetTeamDetailsByIdReturn,
  GetAllTeamsReturn,
  GetAllTeamsWithSpielerReturn,
  GetSaisontabelleReturn,
  GetAllTeamsCompactReturn,
  GetTeamSpielerById,
  FLTeamsFilterParams,
  FLTeamsResponse,
} from "./types";

export async function getTeams(filters: FLTeamsFilterParams = {}): Promise<FLTeamsResponse> {
  "use cache";

  const tags: string[] = ["teams"];
  if (filters.saison_id) tags.push(`teams:saison_id:${filters.saison_id}`);
  if (filters.gruppe) tags.push(`teams:gruppe:${filters.gruppe}`);

  // Check '!== undefined' because 'false' is a valid filter value
  if (filters.is_placeholder !== undefined) tags.push(`teams:is_placeholder:${filters.is_placeholder}`);
  if (filters.is_disqualified !== undefined) tags.push(`teams:is_disqualified:${filters.is_disqualified}`);
  if (filters.in_gruppen !== undefined) tags.push(`teams:in_gruppen:${filters.in_gruppen}`);
  cacheTag(...tags);
  cacheLife("days");

  return apiClient<FLTeamsResponse>("/teams", {
    params: filters as Record<string, string | number | boolean>,
  });
}

/** Fetches all the standings data to display the Saisontabelle */
export const getSaisontabelle = async (): Promise<GetSaisontabelleReturn> => {
  "use cache";

  cacheLife("days");
  cacheTag("saisontabelle");

  return apiClient<GetSaisontabelleReturn>("/teams/saisontabelle");
};

/** Fetches all the teams with their respective players to display Spieler */
export const getAllTeamsWithSpieler = async (): Promise<GetAllTeamsWithSpielerReturn> => {
  "use cache";

  cacheLife("days");
  cacheTag("all_team_with_spieler");

  return apiClient<GetAllTeamsWithSpielerReturn>("/teams/all_teams", { params: { with_spieler: true } });
};

export const getAllTeams = async (): Promise<GetAllTeamsReturn> => {
  "use cache";

  cacheTag("all_teams");

  return apiClient<GetAllTeamsReturn>("/teams/all_teams", { params: { with_spieler: false, include_placeholder: true } });
};

export const getAllTeamsCompact = async (): Promise<GetAllTeamsCompactReturn> => {
  "use cache";

  cacheTag("all_teams_compact");

  return apiClient<GetAllTeamsCompactReturn>("/teams/all_teams_compact");
};

export const getTeamDetailsById = async (team_id: string): Promise<GetTeamDetailsByIdReturn> => {
  "use cache";

  cacheLife("days");
  cacheTag(`team_details_by_id-${team_id}`);

  return apiClient<GetTeamDetailsByIdReturn>("/teams/team_details_by_id", { params: { team_id: team_id } });
};

export const getTeamSpielerById = async (team_id: string): Promise<GetTeamSpielerById> => {
  "use cache";

  cacheLife("days");
  cacheTag(`team_spieler_by_id-${team_id}`);

  return apiClient<GetTeamSpielerById>("/teams/team_spieler_by_id", { params: { team_id: team_id } });
};
