import { orMissing } from "@/core/errors";
import { aufstellungenGetAufstellungSelf } from "@/core/generated/client/sdk";
import { runPersonRead } from "@/shared/utils/personRead";

import type { FLAufstellungResponse } from "@/core/generated/client/types";

/**
 * One club's line-up screen for one fixture, as a seat holder of the club reads it: the fixture, the squad, the stored
 * line-up and its marks. `null` for a fixture that does not exist or does not field the club, which the page answers as
 * not found. Never `"use cache"`: a person's read is made for that person.
 */
export async function getAufstellungSelf(spielId: string, teamId: string): Promise<FLAufstellungResponse | null> {
  return runPersonRead(() => orMissing(aufstellungenGetAufstellungSelf(spielId, teamId)));
}
