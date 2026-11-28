import "server-only";

import { BASE_FETCH_PATH, sendToBackend } from "./api";
import { DRY_RUN } from "./dryRun";

import type { FetchOptions } from "./api";

/**
 * What a generated call may add to its request: everything `sendToBackend` takes but the tier, which the operation's
 * `security` fixes, whether it writes, which the operation's `x-safe` or `x-safe-when` states, and whether it is an
 * hourly pass, which its `x-pass` states. A call site stating any of them fails the type check.
 */
type CallOptions = Omit<FetchOptions, "authType" | "readOnly" | "pass">;

type Tier = FetchOptions["authType"];

function send<T>(tier: Tier, url: string, options: CallOptions | undefined, readOnly: boolean, pass = false): Promise<T> {
  // The generated URL spells the document's whole path, and `sendToBackend` prefixes its base path itself.
  return sendToBackend<T>(url.slice(BASE_FETCH_PATH.length), {
    ...options,
    authType: tier,
    ...(readOnly ? { readOnly } : {}),
    ...(pass ? { pass } : {}),
  });
}

/** Whether the URL asks for the dry run, written by `serializeQuery` below. The base only parses a path. */
const isDryRun = (url: string): boolean => new URL(url, "http://backend.invalid").searchParams.get(DRY_RUN) === "true";

// One export per tier and kind of call, each a function of its own: Orval reads a mutator's parameters from its
// source, and a factory's returned function would read as one parameter. A read transport serves an operation the
// document marks `x-safe`, the dry-run one an operation it marks `x-safe-when`, the pass one an operation it marks
// `x-pass`.
export const baseKeyTransport = <T>(url: string, options?: CallOptions): Promise<T> => send<T>("base", url, options, false);
export const baseKeyReadTransport = <T>(url: string, options?: CallOptions): Promise<T> => send<T>("base", url, options, true);
export const systemKeyTransport = <T>(url: string, options?: CallOptions): Promise<T> => send<T>("system", url, options, false);
export const systemKeyReadTransport = <T>(url: string, options?: CallOptions): Promise<T> => send<T>("system", url, options, true);
export const systemKeyPassTransport = <T>(url: string, options?: CallOptions): Promise<T> => send<T>("system", url, options, false, true);
export const adminKeyTransport = <T>(url: string, options?: CallOptions): Promise<T> => send<T>("admin", url, options, false);
export const adminKeyReadTransport = <T>(url: string, options?: CallOptions): Promise<T> => send<T>("admin", url, options, true);
export const adminKeyDryRunTransport = <T>(url: string, options?: CallOptions): Promise<T> => send<T>("admin", url, options, isDryRun(url));

type QueryValue = string | number | boolean;

/**
 * Orval's query builder, which would send a null value as the string "null": an absent or null value is left out, so
 * its parameter takes its default.
 */
export const serializeQuery = (params: Readonly<Record<string, QueryValue | null | undefined>> | undefined): string => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== null && value !== undefined) query.append(key, String(value));
  }

  return query.toString();
};
