import { apiClient } from "@/core/api";
import { cacheLife, cacheTag } from "next/cache";
import type { GetAllSpieleReturn, GetSpielePreviewReturn, GetSpielhistorieReturn, GetSpielplanReturn } from "./types";

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
export const getSpielePreview = async (): Promise<GetSpielePreviewReturn> => {
  "use cache";

  cacheLife("hours");
  cacheTag("spiele_preview");

  return apiClient<GetSpielePreviewReturn>("/spiele/spiele_preview");
};
