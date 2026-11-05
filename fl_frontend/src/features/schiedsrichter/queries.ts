import { cache } from "react";

import { isRecordMissing } from "@/core/errors";
import { schiedsrichterGetSchiedsrichter, schiedsrichterGetSchiedsrichterById, schiedsrichterGetSelf } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";
import { runPersonRead } from "@/shared/utils/personRead";

import type {
  FLSchiedsrichterListResponse,
  FLSchiedsrichterSelfResponse,
  FLSchiedsrichterSingleResponse,
  SchiedsrichterGetSchiedsrichterParams,
} from "@/core/generated/client/types";

/**
 * Every referee, with their contact details, school and fee. Admin-tier: a referee is a pupil
 * (`READ-CONTACT-001`), and the fee is money (`READ-MONEY-001`).
 *
 * **Uncached, and it stays uncached**: `"use cache"` keys on arguments, not on caller identity.
 */
export async function getSchiedsrichter(filters: SchiedsrichterGetSchiedsrichterParams = {}): Promise<FLSchiedsrichterListResponse> {
  // No cache tag either: one means nothing outside a cache scope.
  return runAdminRead(() => schiedsrichterGetSchiedsrichter(filters));
}

/**
 * One referee by id, whatever state they are in — an erased one has no row for it to answer with,
 * and the list above is narrowed besides.
 *
 * **Uncached** for the reason the list is.
 */
export async function getSchiedsrichterById(schiedsrichterId: string): Promise<FLSchiedsrichterSingleResponse | null> {
  return runAdminRead(() =>
    // `null` for "no such referee", which the editor page turns into `notFound()`. Every other
    // status still throws.
    schiedsrichterGetSchiedsrichterById(schiedsrichterId).catch((error: unknown) => {
      if (isRecordMissing(error)) return null;
      throw error;
    }),
  );
}

/**
 * The signed-in referee's own records, refused `role_not_held` where the backend holds no confirmed
 * referee row for the address the page's own check passed.
 */
// Never `"use cache"`, which keys on the arguments rather than the caller.
export const getSchiedsrichterSelf = cache(async (): Promise<FLSchiedsrichterSelfResponse> => runPersonRead(() => schiedsrichterGetSelf()));
