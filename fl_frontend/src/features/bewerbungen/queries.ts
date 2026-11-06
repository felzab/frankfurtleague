import { cache } from "react";

import { isRecordMissing } from "@/core/errors";
import { bewerbungenGetBewerbung, bewerbungenGetBewerbungen } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import { bewerbungenQueueTerms } from "./facets";

import type { BewerbungenGetBewerbungenParams, FLBewerbungenListResponse, FLBewerbungSingleResponse } from "@/core/generated/client/types";

/**
 * Every application, newest first, narrowable by season and by any number of statuses.
 *
 * **Uncached, and it stays uncached**: `"use cache"` keys on arguments, not caller identity, so a
 * cached read of this admin-tier personal data is a shared slot.
 */
export async function getBewerbungen(filters: BewerbungenGetBewerbungenParams = {}): Promise<FLBewerbungenListResponse> {
  // No cache tag either: one means nothing outside a cache scope.
  return runAdminRead(() => bewerbungenGetBewerbungen(filters));
}

/**
 * The queue as one route's query string selects it. Here rather than at the page: a facet carries a `read`
 * function, which a Server Component may not pass on.
 */
export async function getBewerbungenQueue(
  params: Readonly<Record<string, string | string[] | undefined>>,
  order: "asc" | "desc",
  saisonId: string | undefined,
): Promise<FLBewerbungenListResponse> {
  return getBewerbungen({ order: order, ...bewerbungenQueueTerms(params, saisonId) });
}

/**
 * The one application the triage page decides against, uncached for the reason above. `null` on a
 * 404, which the page turns into `notFound()`; everything else throws.
 */
// `cache` memoizes per RENDER PASS, never `"use cache"`, which keys on the arguments.
export const getBewerbungById = cache(async (bewerbungId: string): Promise<FLBewerbungSingleResponse | null> =>
  runAdminRead(() =>
    bewerbungenGetBewerbung(bewerbungId).catch((error: unknown) => {
      if (isRecordMissing(error)) return null;
      throw error;
    }),
  ),
);
