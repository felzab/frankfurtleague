import { apiClient } from "@/core/api";
import { cacheLife, cacheTag } from "next/cache";
import type { GetAllTeamsDetailReturn, GetAllTeamsReturn, GetAllTeamsWithSpielerReturn, GetSaisontabelleReturn } from "./types";

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

export const getAllTeamsDetail = async (): Promise<GetAllTeamsDetailReturn> => {
  "use cache";

  cacheLife("days");
  cacheTag("all_teams_detail");
  return apiClient<GetAllTeamsDetailReturn>("/teams/all_teams_detail");
};
