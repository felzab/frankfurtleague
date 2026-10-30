import { cache } from "react";

import { identitaetGetKontoLoeschungAnsicht, kontoGetAdresswechsel, kontoGetEinwilligungen } from "@/core/generated/client/sdk";
import { runPersonRead } from "@/shared/utils/personRead";

import type {
  FLKontoAdresswechselResponse,
  FLKontoEinwilligungenResponse,
  FLSelbstErasureAnsichtResponse,
} from "@/core/generated/client/types";

/**
 * Every confirmed consent record the signed-in address holds, empty rather than refused where it holds
 * none: the account page is every signed-in person's.
 */
// Never `"use cache"`, which keys on the arguments rather than the caller.
export const getKontoEinwilligungen = cache(async (): Promise<FLKontoEinwilligungenResponse> => runPersonRead(() => kontoGetEinwilligungen()));

/** Every record the signed-in person's erasure would reach, read off the backend rather than inferred here, so the list shown is the list erased. */
// Never `"use cache"`, for `getKontoEinwilligungen`'s reason.
export const getLoeschungAnsicht = cache(async (): Promise<FLSelbstErasureAnsichtResponse> =>
  runPersonRead(() => identitaetGetKontoLoeschungAnsicht()),
);

/**
 * The signed-in address's address control: whether it holds a record to move, and the change pending there with its
 * new address, whole where the person typed it and masked where the league did.
 */
// Never `"use cache"`, for `getKontoEinwilligungen`'s reason.
export const getKontoAdresswechsel = cache(async (): Promise<FLKontoAdresswechselResponse> => runPersonRead(() => kontoGetAdresswechsel()));
