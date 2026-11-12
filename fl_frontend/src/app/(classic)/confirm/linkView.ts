import { APIBadStatusError } from "@/core/errors";

import type { Code } from "@/core/generated/client/types";

/** Whether the backend refused a call with one of `codes`. */
export const refusedAs = (error: unknown, codes: ReadonlySet<Code>): boolean =>
  error instanceof APIBadStatusError && error.serverErrorCode !== undefined && codes.has(error.serverErrorCode);

/** A token no record holds, and one the backend will not parse: a dead link either way. */
const DEAD: ReadonlySet<Code> = new Set<Code>(["link_invalid", "payload_refused"]);

/**
 * A confirmation link's own read, `null` for a dead link. A failed read is no state of the link's: it reaches the
 * frame's error boundary, which logs it.
 */
export function linkViewOf<View>(read: Promise<View>): Promise<View | null> {
  return read.catch((error: unknown) => {
    if (refusedAs(error, DEAD)) return null;
    throw error;
  });
}
