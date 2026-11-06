import { cache } from "react";

import { isRecordMissing } from "@/core/errors";
import {
  bewerbungenGetBewerbung,
  bewerbungenGetBewerbungenAdmin,
  bewerbungenGetSchulen,
  bewerbungenGetTrikotfarben,
  bewerbungenGetWindow,
} from "@/core/generated/client/sdk";
import { runWithIncomingTrace } from "@/core/traceScope";
import { runAdminRead } from "@/shared/utils/adminRead";

import type {
  FLBewerbungenAdminListResponse,
  FLBewerbungSchulenResponse,
  FLBewerbungSingleResponse,
  FLBewerbungTrikotFarbenResponse,
  FLBewerbungWindowResponse,
} from "@/core/generated/client/types";

/**
 * One season's applications, newest first, with what an acceptance into the season would meet: one read for its list and
 * its Sammel-Zusage, `null` for a season the league does not hold.
 *
 * **Uncached, and it stays uncached**: `"use cache"` keys on arguments, not caller identity, so a cached read of
 * admin-tier data is a shared slot.
 */
// `cache` memoizes per RENDER PASS, for the tab's title and the page, never `"use cache"`.
export const getBewerbungenOfSaison = cache(async (saison: string): Promise<FLBewerbungenAdminListResponse | null> =>
  runAdminRead(() =>
    bewerbungenGetBewerbungenAdmin({ saison_id: saison }).catch((error: unknown) => {
      if (isRecordMissing(error)) return null;
      throw error;
    }),
  ),
);

/**
 * The one application the review page decides against, uncached for the reason above. `null` on a
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
