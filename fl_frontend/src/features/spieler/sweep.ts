import "server-only";

import { identitySweepErasure } from "@/core/generated/client/sdk";

/**
 * One pass over the pupils the season-after rule makes due, the system tier's whoever presses: the rule deletes, never
 * the administrator who activated a season. The scheduler runs one pass at a time. The squad pages stop naming them
 * within the `minutes` lifetime their cached read keeps.
 *
 * Answers the counts and the season the rule kept, never a person, the backend's own lines naming a failed person's id:
 * `open` the pupils it failed. Those its deadline left are the next pass's, and a call that failed rejects.
 */
export async function runErasureSweep() {
  const counts = await identitySweepErasure();

  // Spread into a plain object: the generated interface declares no index signature, which the scheduler's count reads.
  return { count: { ...counts }, open: counts.failed };
}
