import { orMissing } from "@/core/errors";
import { aufstellungenGetAufstellung, aufstellungenGetAufstellungSelf } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";
import { runPersonRead } from "@/shared/utils/personRead";

import type { FLAufstellungResponse } from "@/core/generated/client/types";

/**
 * One club's line-up screen for one fixture, as an administrator reads it: the same screen a seat holder reads. `null`
 * for a fixture that does not exist or does not field the club, which the page answers as not found. Never
 * `"use cache"`, which keys on the arguments rather than the caller.
 */
export async function getAufstellung(spielId: string, teamId: string): Promise<FLAufstellungResponse | null> {
  return runAdminRead(() => orMissing(aufstellungenGetAufstellung(spielId, teamId)));
}

/**
 * One club's line-up screen for one fixture, as a seat holder of the club reads it: the fixture, the squad, the stored
 * line-up and its marks. `null` for a fixture that does not exist or does not field the club, which the page answers as
 * not found. Never `"use cache"`, which keys on the arguments rather than the caller.
 */
export async function getAufstellungSelf(spielId: string, teamId: string): Promise<FLAufstellungResponse | null> {
  return runPersonRead(() => orMissing(aufstellungenGetAufstellungSelf(spielId, teamId)));
}
