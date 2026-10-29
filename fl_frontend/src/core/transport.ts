import "server-only";

import { BASE_FETCH_PATH, queryOf, sendToBackend } from "./api";

import type { FetchOptions } from "./api";

/**
 * What a generated call may add to its request: everything `sendToBackend` takes but the tier, which the operation's
 * `security` fixes in `fl_frontend/orval.config.ts`, and the query, which the generated URL already carries.
 */
type CallOptions = Omit<FetchOptions, "authType" | "params">;

type Tier = NonNullable<FetchOptions["authType"]>;

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

/** Orval's query builder, which would send a null value as the string "null". */
export const serializeQuery = (params: FetchOptions["params"]): string => queryOf(params).toString();
