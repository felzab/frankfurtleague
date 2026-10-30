import { spieleGetSpieleActionRequired } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLSpieleActionRequiredResponse, SpieleGetSpieleActionRequiredParams } from "@/core/generated/client/types";

/**
 * Uncached deliberately, as every admin-authed read is. Being uncached is
 * also what lets it seed the request's trace scope.
 */
export const getAdminSpieleActionRequired = async (
  filters: SpieleGetSpieleActionRequiredParams = {},
): Promise<FLSpieleActionRequiredResponse> =>
  // Optional as the server's parameter is, yet never omitted by a page: the backend resolves an omitted
  // one to the active season, which need not be the header's.
  runAdminRead(() => spieleGetSpieleActionRequired(filters));
