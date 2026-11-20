import { cache } from "react";

import { orMissing } from "@/core/errors";
import { bewerbungenGetBewerbung, bewerbungenGetBewerbungenAdmin } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLBewerbungenAdminListResponse, FLBewerbungSingleResponse } from "@/core/generated/client/types";

/** One read serves the list and its Sammel-Zusage; `null` for a season the league does not hold. */
// `cache` memoizes per render pass, for the tab's title and the page.
export const getBewerbungenOfSaison = cache(async (saison: string): Promise<FLBewerbungenAdminListResponse | null> =>
  runAdminRead(() => orMissing(bewerbungenGetBewerbungenAdmin({ saison_id: saison }))),
);

export const getBewerbungById = cache(async (bewerbungId: string): Promise<FLBewerbungSingleResponse | null> =>
  runAdminRead(() => orMissing(bewerbungenGetBewerbung(bewerbungId))),
);
