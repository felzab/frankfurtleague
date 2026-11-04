import { APIBadStatusError, mayHaveWritten } from "./errors";
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
 * Whether a write's answer says it did not stand. The backend's promise: a 4xx refuses the request. A 5xx promises
 * nothing, since the server may fail after a commit, and a write that may stand answers `unknown_outcome` with a 500;
 * neither does an answer naming no code, an edge's own page or an unreadable body.
 */
const refusedUnwritten = (error: unknown): boolean =>
  error instanceof APIBadStatusError && error.statusCode >= 400 && error.statusCode < 500 && error.serverErrorCode !== undefined;

/**
 * Sends one call, a write recorded as standing before `send` runs, since one whose answer never comes may still have
 * landed, and taken back where `send` throws the backend's refusal of it. Outside `api.ts` because the client's test
 * double replaces that module and sends through here, so neither can record a write the other does not.
 */
export async function dispatchRequest<T>(sent: SentRequest, send: () => Promise<T>): Promise<T> {
  if (!mayHaveWritten(sent)) return send();

  const withdraw = recordWriteSent();
  try {
    return await send();
  } catch (error) {
    if (refusedUnwritten(error)) withdraw();
    throw error;
  }
}
