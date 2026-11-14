import { isRefusal, mayHaveWritten } from "./errors";
import { recordWriteSent } from "./requestScope";

import type { SentRequest } from "./errors";

/**
 * A call as the write test reads it: `fetch`'s own default method, upper-cased so the safe-method test
 * reads any spelling alike, since `fetch` sends `patch` exactly as typed.
 */
export const sentRequestOf = (method: string | undefined, readOnly: boolean | undefined): SentRequest => ({
  method: (method ?? "GET").toUpperCase(),
  readOnly: readOnly === true,
});

/**
 * Sends one call, a write recorded as standing before `send` runs, since one whose answer never comes may still have
 * landed, and taken back where `send` throws the backend's refusal of it.
 */
export async function dispatchRequest<T>(sent: SentRequest, send: () => Promise<T>): Promise<T> {
  if (!mayHaveWritten(sent)) return send();

  const withdraw = recordWriteSent();
  try {
    return await send();
  } catch (error) {
    // Taken back only where the answer says the write did not stand. The backend's promise: a 4xx refuses the
    // request. A 5xx promises nothing, since the server may fail after a commit, and a write that may stand answers
    // `unknown_outcome` with a 500; neither does an answer naming no code, an edge's own page or an unreadable body.
    if (isRefusal(error) && error.serverErrorCode !== undefined) withdraw();
    throw error;
  }
}
