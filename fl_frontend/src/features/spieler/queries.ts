import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";

import {
  spielerGetKader,
  spielerGetSelbst,
  spielerGetSpieler,
  spielerGetSpielerMemberships,
  spielerGetSpielerNachnominierung,
} from "@/core/generated/client/sdk";
import { SITE_CACHE_TAG } from "@/core/siteCache";
import { runAdminRead } from "@/shared/utils/adminRead";
import { runPersonRead } from "@/shared/utils/personRead";

import type {
  FLKaderResponse,
  FLSpielerListResponse,
  FLSpielerMembershipsResponse,
  FLSpielerNachnominierungResponse,
  FLSpielerSelbstResponse,
  SpielerGetSpielerParams,
} from "@/core/generated/client/types";

export async function getSpieler(filters: SpielerGetSpielerParams = {}): Promise<FLSpielerListResponse> {
  "use cache";

  cacheTag(SITE_CACHE_TAG);
  cacheLife("minutes");

  return spielerGetSpieler(filters);
}

/**
 * `getSpieler` cannot serve the admin surfaces at any filter setting.
 */
// Never `"use cache"` here, which keys on the arguments rather than the caller.
export const getSpielerMemberships = cache(async (): Promise<FLSpielerMembershipsResponse> =>
  runAdminRead(() => spielerGetSpielerMemberships()),
);

/** Whether the squad create would mark an entry into this season a Nachnominierung today. */
// Never `"use cache"`, for `getSpielerMemberships`' reason, and because the answer turns over at midnight.
export const getSpielerNachnominierung = cache(async (saisonId: string): Promise<FLSpielerNachnominierungResponse> =>
  runAdminRead(() => spielerGetSpielerNachnominierung(saisonId)),
);

/**
 * One team's squad as its seat holder reads it, refused `REQ-FUNKTION-001` where the backend does not
 * find the seat the page's own check found.
 */
// Never `"use cache"`, for `getSpielerMemberships`' reason: what it answers is the reading person's.
export const getKader = cache(async (teamId: string, saisonId: string): Promise<FLKaderResponse> =>
  runPersonRead(() => spielerGetKader(teamId, saisonId)),
);

/**
 * The signed-in pupil's own record, refused `REQ-FUNKTION-001` where the backend holds no confirmed
 * pupil row for the address the page's own check passed.
 */
// Never `"use cache"`, for `getSpielerMemberships`' reason: what it answers is the reading person's.
export const getSpielerSelbst = cache(async (): Promise<FLSpielerSelbstResponse> => runPersonRead(() => spielerGetSelbst()));
