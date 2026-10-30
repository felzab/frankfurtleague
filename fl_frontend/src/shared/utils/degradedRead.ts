// Redesign: goes with its last importer; a rebuilt page's failed read throws to the frame's one error page.
import "server-only";

import { unstable_rethrow } from "next/navigation";

import { APINetworkError, ContractBreakError, loggedByBackend, requestOf, UnreadGrantError } from "@/core/errors";
import { logger } from "@/core/logging";

import { isRuleRefusal } from "./actionError";

/**
 * Whether a failed read explains itself: the network never answered it, or one of the API's rules refused it. Anything
 * else, a narrowing bug or a rotated key's protocol refusal included, would leave a plausible panel standing unlogged.
 */
export function explainsItself(error: unknown): boolean {
  // An unread grant is the guard's own read failing, which the guard logged as it refused.
  return error instanceof APINetworkError || error instanceof UnreadGrantError || isRuleRefusal(error);
}

// A failure the backend answered is its own line's, so it is written once.
function logReadFailure(message: string, error: unknown): void {
  if (loggedByBackend(error)) return;

  // A `"use cache"` fill's throw arrives as a plain `Error` carrying Next's digest, which joins this line to the line
  // a production build writes of the original.
  const digest: unknown = error instanceof Error ? Reflect.get(error, "digest") : undefined;
  logger.error(message, error, {
    // The failed call's own trace, which the backend's line carries; the logger falls back to the request's scope.
    ...requestOf(error),
    digest: typeof digest === "string" ? digest : undefined,
  });
}

// Attached inside `runWithIncomingTrace`'s scope at its call site: outside it, an untyped failure's line names no request.
/**
 * A page's degraded read's rejection handler: a failed read settles to the page's `null`, and a contract break reaches
 * the error boundary, which logs it.
 */
export function nullUnlessContractBreak(error: unknown): null {
  // A `redirect()` or `notFound()` the read threw is a navigation, never a failed read.
  unstable_rethrow(error);
  if (error instanceof ContractBreakError) throw error;
  if (!explainsItself(error)) logReadFailure("read.page_failed", error);

  return null;
}

// Attached inside `runWithIncomingTrace`'s scope at its call site: outside it, an untyped failure's line names no request.
/**
 * An admin editor's label readout's rejection handler, logging every failure that does not explain itself. The editor is
 * the operator's tool for repairing the record, so it stands where a person-facing page would not render.
 */
export function nullAfterLoggingUnexplained(error: unknown): null {
  // A `redirect()` or `notFound()` the read threw is a navigation, never a failed read.
  unstable_rethrow(error);
  if (error instanceof ContractBreakError) logger.error("read.contract_break_absorbed", error);
  else if (!explainsItself(error)) logReadFailure("read.readout_failed", error);

  return null;
}
