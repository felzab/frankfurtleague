import { cache } from "react";

import { orMissing } from "@/core/errors";
import { bewerbungenGetBewerbung, bewerbungenGetBewerbungenAdmin } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLBewerbungenAdminListResponse, FLBewerbungSingleResponse } from "@/core/generated/client/types";

/**
 * One season's applications, newest first, with what an acceptance into the season would meet: one read for its list and
 * its Sammel-Zusage, `null` for a season the league does not hold.
 *
 * **Uncached, and it stays uncached**: `"use cache"` keys on arguments, not caller identity, so a cached read of
 * admin-tier data is a shared slot.
 */
// `cache` memoizes per RENDER PASS, for the tab's title and the page, never `"use cache"`.
export const getBewerbungenOfSaison = cache(async (saison: string): Promise<FLBewerbungenAdminListResponse | null> =>
  runAdminRead(() => orMissing(bewerbungenGetBewerbungenAdmin({ saison_id: saison }))),
);

/**
 * The one application the review page decides against, uncached for the reason above. `null` on a
 * 404, which the page turns into `notFound()`; everything else throws.
 */
// `cache` memoizes per RENDER PASS, never `"use cache"`, which keys on the arguments.
export const getBewerbungById = cache(async (bewerbungId: string): Promise<FLBewerbungSingleResponse | null> =>
  runAdminRead(() => orMissing(bewerbungenGetBewerbung(bewerbungId))),
);
