import { cache } from "react";

import { apiClient } from "@/core/api";
import { runPersonRead } from "@/shared/utils/personRead";

import { FLKontoEinwilligungenResponseSchema } from "./schemas";

import type { FLKontoEinwilligungenResponse } from "./schemas";

/**
 * Every confirmed consent record the signed-in address holds, empty rather than refused where it holds
 * none: the account page is every signed-in person's.
 */
// Never `"use cache"`, which keys on the arguments rather than the caller (`docs/frontend/spec.md` §1.2).
export const getKontoEinwilligungen = cache(async (): Promise<FLKontoEinwilligungenResponse> =>
  runPersonRead(() =>
    apiClient<FLKontoEinwilligungenResponse>("/konto/einwilligungen", FLKontoEinwilligungenResponseSchema, { authType: "admin" }),
  ),
);
