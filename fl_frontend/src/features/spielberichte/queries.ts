import "server-only";

import { orMissing } from "@/core/errors";
import { spielberichteGetSpielberichtBericht } from "@/core/generated/client/sdk";
import { runPersonRead } from "@/shared/utils/personRead";

import type { FLSpielberichtSchiedsrichterResponse } from "@/core/generated/client/types";

/**
 * `null` for a fixture that does not exist; the backend's refusals (`bericht_not_officiated`, `role_not_held`) reach
 * the caller, whose page says what each means for it.
 */
// A person's read, never `"use cache"`, which keys on the arguments rather than the caller.
export async function getOwnSpielbericht(spielId: string): Promise<FLSpielberichtSchiedsrichterResponse | null> {
  return runPersonRead(() => orMissing(spielberichteGetSpielberichtBericht(spielId)));
}
