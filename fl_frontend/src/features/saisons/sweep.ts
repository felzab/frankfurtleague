import "server-only";

import { sweepErasure } from "./erasure";
import { postErasureSweep } from "./mutations";

/**
 * One pass over the pupils the season-after rule makes due. The scheduler runs one pass at a time. The squad pages stop
 * naming them within the `minutes` lifetime their cached read keeps.
 *
 * Without a deadline of its own: a timer has no request a long run would hold back. Answers the counts and the season
 * the rule kept, never a person, the backend's own lines naming a failed person's id: `open` the pupils a finished pass
 * failed or passed over, and a pass a call cut short its failures, with that call's `error`.
 */
export async function runErasureSweep() {
  const run = await sweepErasure(postErasureSweep);

  if (!run.cutShort) {
    const { cutShort: _finished, ...counts } = run;
    return { count: counts, open: counts.remaining };
  }

  const { cutShort: _cutShort, error, ...previous } = run;
  return { count: previous, open: previous.failed, error };
}
