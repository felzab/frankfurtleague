import { apiClient } from "@/core/api";
import type { GetAdminSpieleOverviewReturn } from "./types";

export const getAdminSpieleOverview = async (): Promise<GetAdminSpieleOverviewReturn> => {
  return apiClient<GetAdminSpieleOverviewReturn>("/admin/spiele_overview", { authType: "admin" });
};
