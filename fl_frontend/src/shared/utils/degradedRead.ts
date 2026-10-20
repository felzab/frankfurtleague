import "server-only";

import { unstable_rethrow } from "next/navigation";

import {
  APIBadStatusError,
  APIMalformedDataError,
  APINetworkError,
  ApiUnsentError,
  isContractBreak,
  requestOf,
  UnreadGrantError,
} from "@/core/errors";
import { logger } from "@/core/logging";

import { isRuleRefusal } from "./actionError";

/**
 * Whether a failed read explains itself: the network never answered it, or one of the API's rules refused it. Anything
 * else, a narrowing bug or a rotated key's protocol refusal included, would leave a plausible panel standing unlogged.
 */
export function explainsItself(error: unknown): boolean {
  // An unread grant is the guard's own read failing, which the guard logged as it refused (`FE-AUTH-010`).
  return error instanceof APINetworkError || error instanceof ApiUnsentError || error instanceof UnreadGrantError || isRuleRefusal(error);
}

export function logCodedFailure(message: string, error: unknown, untypedCode: "FE-ACT-001" | "FE-RSC-001"): void {
  const typed =
    error instanceof APIBadStatusError ||
    error instanceof APINetworkError ||
    error instanceof APIMalformedDataError ||
    error instanceof ApiUnsentError;
  // A `"use cache"` fill's throw arrives as a plain `Error` carrying Next's digest, which joins this line to Next's
  // own line of the original (`docs/frontend/spec.md` §1.2).
  const digest: unknown = error instanceof Error ? Reflect.get(error, "digest") : undefined;
  logger.error(message, error, {
    error_code: typed ? error.code : untypedCode,
    // The failed call's own trace, which the backend's line carries; the logger falls back to the request's scope.
    ...requestOf(error),
    digest: typeof digest === "string" ? digest : undefined,
  });
}

/**
 * A page's degraded read's rejection handler: a failed read settles to the page's `null`, and a contract break reaches
 * the error boundary, which logs it (`docs/frontend/spec.md :: I650`).
 */
export function nullUnlessContractBreak(error: unknown): null {
  // A `redirect()` or `notFound()` the read threw is a navigation, never a failed read.
  unstable_rethrow(error);
  if (isContractBreak(error)) throw error;
  if (!explainsItself(error)) logCodedFailure("A page's read failed and its panel stands", error, "FE-RSC-001");

  return null;
}

/**
 * An admin editor's label readout's rejection handler, logging every failure that does not explain itself. The editor is
 * the operator's tool for repairing the record, so it stands where a person-facing page would not render.
 */
export function nullAfterLoggingUnexplained(error: unknown): null {
  // A `redirect()` or `notFound()` the read threw is a navigation, never a failed read.
  unstable_rethrow(error);
  if (isContractBreak(error)) logger.error("Contract break absorbed by an admin readout", error, { error_code: "FE-RSC-001" });
  else if (!explainsItself(error)) logCodedFailure("An admin readout's read failed and its editor stands", error, "FE-RSC-001");

  return null;
}
