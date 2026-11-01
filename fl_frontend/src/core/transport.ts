import "server-only";

import { BASE_FETCH_PATH, sendToBackend } from "./api";

import type { FetchOptions } from "./api";

/**
 * What a generated call may add to its request: everything `sendToBackend` takes but the tier, which the operation's
 * `security` fixes in `fl_frontend/orval.config.ts`.
 */
type CallOptions = Omit<FetchOptions, "authType">;

type Tier = FetchOptions["authType"];

function send<T>(tier: Tier, url: string, options: CallOptions | undefined): Promise<T> {
  // The generated URL spells the document's whole path, and `sendToBackend` prefixes its base path itself.
  if (!url.startsWith(`${BASE_FETCH_PATH}/`)) throw new Error(`Not an endpoint under ${BASE_FETCH_PATH}: ${url}`);

  return sendToBackend<T>(url.slice(BASE_FETCH_PATH.length), { ...options, authType: tier });
}

// One export per tier, each a function of its own: Orval reads a mutator's parameters from its source, and a
// factory's returned function would read as one parameter.
export const baseKeyTransport = <T>(url: string, options?: CallOptions): Promise<T> => send<T>("base", url, options);
export const systemKeyTransport = <T>(url: string, options?: CallOptions): Promise<T> => send<T>("system", url, options);
export const adminKeyTransport = <T>(url: string, options?: CallOptions): Promise<T> => send<T>("admin", url, options);
export const unkeyedTransport = <T>(url: string, options?: CallOptions): Promise<T> => send<T>("none", url, options);

type QueryValue = string | number | boolean;

/**
 * Orval's query builder, which would send a null value as the string "null": an absent or null value is left out, so
 * its parameter takes its default, and a list is sent as one key per value, the repeated key FastAPI reads a `list`
 * query parameter from (https://fastapi.tiangolo.com/tutorial/query-params-str-validations/).
 */
export const serializeQuery = (params: Readonly<Record<string, QueryValue | readonly QueryValue[] | null | undefined>> | undefined): string => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    for (const item of [value].flat()) {
      if (item !== null && item !== undefined) query.append(key, String(item));
    }
  }

  return query.toString();
};
