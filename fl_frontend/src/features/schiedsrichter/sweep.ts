import "server-only";

import { schiedsrichterSweepSchiedsrichter } from "@/core/generated/client/sdk";

/**
 * One pass over the referee entries whose link lapsed unanswered, erasing them. The scheduler runs one pass at a time. A
 * call that failed rejects; the pass resolves to what it did, `open` the entries it could not erase.
 */
export async function runSchiedsrichterSweep() {
  const { erased, failed } = await schiedsrichterSweepSchiedsrichter();

  return { count: { schiedsrichter_erased: erased, schiedsrichter_failed: failed }, open: failed };
}
