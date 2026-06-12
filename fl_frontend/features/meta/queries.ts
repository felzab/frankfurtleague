import { cacheTag } from "next/cache";
import type { getCurrentSaisonMetadataReturn } from "./types";
import { apiClient } from "@/core/api";

export const getSaisonMetadata = async (saisonId: string | null = null): Promise<getCurrentSaisonMetadataReturn> => {
  "use cache";

  cacheTag("saison_metadata");

  return apiClient<getCurrentSaisonMetadataReturn>("/meta/saison_metadata", { params: { saison_id: saisonId } });
};
