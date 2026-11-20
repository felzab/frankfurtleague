import { asRefusal } from "@/core/errors";

import type { Code } from "@/core/generated/client/types";

/**
 * Every refusal of a link's read that means the dead link: a token nothing could place, or one the backend will not
 * parse, which matches no record. Every state a live or ended change can be in answers in a 200, and a refusal of the
 * key or the route is a deploy's fault, so it reaches the error boundary as a failed read.
 */
const DEAD_LINK: ReadonlySet<Code> = new Set<Code>(["body_unreadable", "payload_refused", "link_invalid"]);

export function readsAsDeadLink(error: unknown): boolean {
  const code = asRefusal(error)?.serverErrorCode;
  return code !== undefined && DEAD_LINK.has(code);
}

/**
 * Every refusal of an answer or a stop, one end for all, so the link's holder learns nothing about who holds an address:
 * a drifted page, a link spent or lapsed, a change ended since the page opened, a new address now somebody's, or an
 * address on file left holding nothing to move.
 */
const LINK_ENDED: ReadonlySet<Code> = new Set<Code>([
  "body_unreadable",
  "payload_refused",
  "link_invalid",
  "link_expired",
  "address_change_ended",
  "address_change_nothing",
  "address_change_taken",
  "duplicate_key",
]);

export function endsTheLink(error: unknown): boolean {
  const code = asRefusal(error)?.serverErrorCode;
  return code !== undefined && LINK_ENDED.has(code);
}
