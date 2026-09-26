import { mayHaveWritten } from "./errors";
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
 * The write is recorded before `send`: one whose answer never comes may still have landed. Outside
 * `api.ts` because the client's test double replaces that module and sends through here, so neither
 * can record a write the other does not.
 */
export async function dispatchRequest<T>(sent: SentRequest, send: () => Promise<T>): Promise<T> {
  if (mayHaveWritten(sent)) recordWriteSent();
  return send();
}
