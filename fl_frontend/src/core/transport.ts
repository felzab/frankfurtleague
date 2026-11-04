import "server-only";

import { BASE_FETCH_PATH, sendToBackend } from "./api";

import type { FetchOptions } from "./api";

/**
 * What a generated call may add to its request: everything `sendToBackend` takes but the tier, which the operation's
 * `security` fixes, and whether it writes, which the operation's `x-safe` or `x-safe-when` states
 * (`fl_frontend/orval.config.ts :: transportOf`). A call site stating either fails the type check.
 */
type CallOptions = Omit<FetchOptions, "authType" | "readOnly">;

type Tier = FetchOptions["authType"];

/** The query parameter whose `true` makes a dry run of a write, which the backend's `x-safe-when` names. */
const DRY_RUN = "dry_run";

function send<T>(tier: Tier, url: string, options: CallOptions | undefined, readOnly: boolean): Promise<T> {
  // The generated URL spells the document's whole path, and `sendToBackend` prefixes its base path itself.
  if (!url.startsWith(`${BASE_FETCH_PATH}/`)) throw new Error(`Not an endpoint under ${BASE_FETCH_PATH}: ${url}`);

  return sendToBackend<T>(url.slice(BASE_FETCH_PATH.length), { ...options, authType: tier, ...(readOnly ? { readOnly } : {}) });
}

/** Whether the URL asks for the dry run, written by `serializeQuery` below. The base only parses a path. */
const isDryRun = (url: string): boolean => new URL(url, "http://backend.invalid").searchParams.get(DRY_RUN) === "true";

// One export per tier and kind of call, each a function of its own: Orval reads a mutator's parameters from its
// source, and a factory's returned function would read as one parameter. A read transport serves an operation the
// document marks `x-safe`, the dry-run one an operation it marks `x-safe-when`.
export const baseKeyTransport = <T>(url: string, options?: CallOptions): Promise<T> => send<T>("base", url, options, false);
export const baseKeyReadTransport = <T>(url: string, options?: CallOptions): Promise<T> => send<T>("base", url, options, true);
export const systemKeyTransport = <T>(url: string, options?: CallOptions): Promise<T> => send<T>("system", url, options, false);
export const systemKeyReadTransport = <T>(url: string, options?: CallOptions): Promise<T> => send<T>("system", url, options, true);
export const adminKeyTransport = <T>(url: string, options?: CallOptions): Promise<T> => send<T>("admin", url, options, false);
export const adminKeyReadTransport = <T>(url: string, options?: CallOptions): Promise<T> => send<T>("admin", url, options, true);
export const adminKeyDryRunTransport = <T>(url: string, options?: CallOptions): Promise<T> => send<T>("admin", url, options, isDryRun(url));
export const unkeyedTransport = <T>(url: string, options?: CallOptions): Promise<T> => send<T>("none", url, options, false);

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
