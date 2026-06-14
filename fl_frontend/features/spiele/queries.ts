import { apiClient } from "@/core/api";
import { cacheLife, cacheTag } from "next/cache";
import type {
  GetAllSpieleReturn,
  GetPlayoffsSpieleReturn,
  GetRecentAndUpcomingSpieleReturn,
  GetSpielhistorieReturn,
  GetSpielplanReturn,
} from "./types";

/** Fetches all the game-days and their respective games to display the Spielplan*/
export const getSpielplan = async (): Promise<GetSpielplanReturn> => {
  "use cache";

  cacheLife("days");
  cacheTag("spielplan");

  return apiClient<GetSpielplanReturn>("/spiele/spielplan");
};

/** Fetches all past games to display Spielhistorie */
export const getSpielhistorie = async (): Promise<GetSpielhistorieReturn> => {
  "use cache";

  cacheLife("days");
  cacheTag("spielhistorie");

  return apiClient<GetSpielhistorieReturn>("/spiele/spielhistorie");
};

/** Fetches all games to display Spielsuche */
export const getAllSpiele = async (): Promise<GetAllSpieleReturn> => {
  "use cache";

  cacheLife("days");
  cacheTag("all_spiele");

  return apiClient<GetAllSpieleReturn>("/spiele/all_spiele");
};

/** Fetches upcoming games to display in an overview */
export const getRecentAndUpcomingSpiele = async (amount: number = 6): Promise<GetRecentAndUpcomingSpieleReturn> => {
  "use cache";

  cacheLife("hours");
  cacheTag("recent_and_upcoming_spiele");

  return apiClient<GetRecentAndUpcomingSpieleReturn>("/spiele/recent_and_upcoming_spiele", { params: { amount: amount } });
};

export const getPlayoffsSpiele = async (): Promise<GetPlayoffsSpieleReturn> => {
  "use cache";

  cacheLife("hours");
  cacheTag("playoffs_spiele");

  return apiClient<GetPlayoffsSpieleReturn>("/spiele/playoffs_spiele");
};
