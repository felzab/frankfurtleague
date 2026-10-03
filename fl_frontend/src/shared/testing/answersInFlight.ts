import assert from "node:assert/strict";
// Imported rather than global: a case's mocked clock holds the globals, and would hold the wait with them.
import { setImmediate as nextTurn, setTimeout as wallClock } from "node:timers/promises";

/** One answer a double handed out and has not yet seen land, named as the failure reports it. */
export type InFlight = { name: string; answer: Promise<unknown> };

/**
 * A double settles within its microtasks, so only an answer nobody gives reaches this bound. Unbounded,
 * the case awaiting that answer hangs until the runner cancels its file, naming nothing.
 */
export const ANSWER_WAIT_MS = 2_000;

/** `inFlight` is read again after a turn between rounds, which waits for a request an answer sets off. */
export async function untilAnswered(inFlight: () => readonly InFlight[], repair: string): Promise<void> {
  const lapse = new AbortController();
  const lapsed = wallClock(ANSWER_WAIT_MS, true, { signal: lapse.signal, ref: false }).catch(() => false);
  try {
    do {
      const settled = Promise.allSettled(inFlight().map(({ answer }) => answer)).then(() => false);
      if (await Promise.race([settled, lapsed])) {
        const left = inFlight()
          .map(({ name }) => name)
          .join(", ");
        assert.fail(`still unanswered after ${String(ANSWER_WAIT_MS)} ms: ${left}; ${repair}`);
      }
      await nextTurn();
    } while (inFlight().length > 0);
  } finally {
    lapse.abort();
  }
}
