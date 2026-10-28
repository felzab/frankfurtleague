import { cache } from "react";

import { apiClient } from "@/core/api";
import { FLSelbstErasureAnsichtResponseSchema } from "@/core/schemas";
import { runPersonRead } from "@/shared/utils/personRead";

import { FLKontoAdresswechselResponseSchema, FLKontoEinwilligungenResponseSchema } from "./schemas";

import type { FLSelbstErasureAnsichtResponse } from "@/core/schemas";
import type { FLKontoAdresswechselResponse, FLKontoEinwilligungenResponse } from "./schemas";

/**
 * Every confirmed consent record the signed-in address holds, empty rather than refused where it holds
 * none: the account page is every signed-in person's.
 */
// Never `"use cache"`, which keys on the arguments rather than the caller.
export const getKontoEinwilligungen = cache(async (): Promise<FLKontoEinwilligungenResponse> =>
  runPersonRead(() =>
    apiClient<FLKontoEinwilligungenResponse>("/konto/einwilligungen", FLKontoEinwilligungenResponseSchema, { authType: "admin" }),
  ),
);

/** Every record the signed-in person's erasure would reach, read off the backend rather than inferred here, so the list shown is the list erased. */
// Never `"use cache"`, for `getKontoEinwilligungen`'s reason.
export const getLoeschungAnsicht = cache(async (): Promise<FLSelbstErasureAnsichtResponse> =>
  runPersonRead(() =>
    apiClient<FLSelbstErasureAnsichtResponse>("/identitaet/selbst/erasure/ansicht", FLSelbstErasureAnsichtResponseSchema, {
      authType: "admin",
    }),
  ),
);

/**
 * The signed-in address's address control: whether it holds a record to move, and the change pending there with its
 * new address, whole where the person typed it and masked where the league did.
 */
// Never `"use cache"`, for `getKontoEinwilligungen`'s reason.
export const getKontoAdresswechsel = cache(async (): Promise<FLKontoAdresswechselResponse> =>
  runPersonRead(() =>
    apiClient<FLKontoAdresswechselResponse>("/konto/adresswechsel", FLKontoAdresswechselResponseSchema, { authType: "admin" }),
  ),
);
