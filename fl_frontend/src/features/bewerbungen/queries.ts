import { cache } from "react";

import { isRecordMissing } from "@/core/errors";
import {
  bewerbungenGetBewerbung,
  bewerbungenGetBewerbungen,
  bewerbungenGetSchulen,
  bewerbungenGetTrikotfarben,
  bewerbungenGetWindow,
} from "@/core/generated/client/sdk";
import { runWithIncomingTrace } from "@/core/traceScope";
import { runAdminRead } from "@/shared/utils/adminRead";

import { bewerbungenQueueTerms } from "./facets";

import type {
  BewerbungenGetBewerbungenParams,
  FLBewerbungenListResponse,
  FLBewerbungSchulenResponse,
  FLBewerbungSingleResponse,
  FLBewerbungTrikotFarbenResponse,
  FLBewerbungWindowResponse,
} from "@/core/generated/client/types";

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

/**
 * One season's window, `null` where that season records none — and `null` for the whole answer where
 * no season carries the id, which is the page's `notFound()`.
 */
// `cache`, never `"use cache"`: the metadata and the body read this once between them, and a cache
// would key on the season and go on serving `laeuft` after the window shut.
export const getBewerbungWindow = cache(async (saisonId: string): Promise<{ window: FLBewerbungWindowResponse | null } | null> =>
  runWithIncomingTrace(() =>
    bewerbungenGetWindow(saisonId)
      // The answer naming no window carries the one key a window has not got.
      .then((response) => ("window" in response ? { window: null } : { window: response }))
      .catch((error: unknown) => {
        if (isRecordMissing(error)) return null;
        throw error;
      }),
  ),
);

/** The clubs a school picks itself out of, name and id alone, in the order the picker offers them. */
export async function getBewerbungSchulen(): Promise<FLBewerbungSchulenResponse> {
  return runWithIncomingTrace(() => bewerbungenGetSchulen());
}

/**
 * Which colours one season has ASSIGNED — `saison_teams.trikot_farbe`, never a wish. Uncached: one is assigned between two page loads, and a cached
 * "still free" outlives that.
 */
export async function getBewerbungTrikotfarben(saisonId: string): Promise<FLBewerbungTrikotFarbenResponse> {
  return runWithIncomingTrace(() => bewerbungenGetTrikotfarben(saisonId));
}
