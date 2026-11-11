import "server-only";

import { orMissing } from "@/core/errors";
import { spielberichteGetSpielberichtBericht } from "@/core/generated/client/sdk";
import { runPersonRead } from "@/shared/utils/personRead";

import type { FLSpielberichtSchiedsrichterResponse } from "@/core/generated/client/types";

/**
 * One fixture's report as its booked referee reads it, `null` for a fixture that does not exist. A person's read, so
 * **uncached**: the backend's refusals (`bericht_not_officiated`, `role_not_held`) reach the caller, whose page says
 * what each means for it.
 */
export async function getOwnSpielbericht(spielId: string): Promise<FLSpielberichtSchiedsrichterResponse | null> {
  return runPersonRead(() => orMissing(spielberichteGetSpielberichtBericht(spielId)));
}
