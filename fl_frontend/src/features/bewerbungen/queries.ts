import { cache } from "react";

import { orMissing } from "@/core/errors";
import { bewerbungenGetBewerbung, bewerbungenGetBewerbungenAdmin } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLBewerbungenAdminListResponse, FLBewerbungSingleResponse } from "@/core/generated/client/types";

/** One read serves the list and its Sammel-Zusage; `null` for a season the league does not hold. */
// `cache` memoizes per render pass, for the tab's title and the page. Never `"use cache"`, which keys on the arguments
// rather than the caller, so a cached read of admin-tier data is a shared slot.
export const getBewerbungenOfSaison = cache(async (saison: string): Promise<FLBewerbungenAdminListResponse | null> =>
  runAdminRead(() => orMissing(bewerbungenGetBewerbungenAdmin({ saison_id: saison }))),
);

/** `null` on a 404, which the page turns into `notFound()`; everything else throws. */
// `cache` memoizes per render pass. Never `"use cache"`, which keys on the arguments rather than the caller.
export const getBewerbungById = cache(async (bewerbungId: string): Promise<FLBewerbungSingleResponse | null> =>
  runAdminRead(() => orMissing(bewerbungenGetBewerbung(bewerbungId))),
);
