import { isRefusal, isRuleRefusal } from "@/core/errors";

import type { Code } from "@/core/generated/client/types";

/**
 * Whether a refused link read means the dead link rather than a failed read. Every state a live or ended change can be
 * in answers in a 200, so a refusal is a token nothing could place, and a token the backend will not parse matches no
 * record.
 */
export function readsAsDeadLink(error: unknown): boolean {
  if (!isRefusal(error)) return false;
  return error.serverErrorCode === "payload_refused" || isRuleRefusal(error);
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
  "address_change_new_granted",
  "address_change_occupied",
  "duplicate_key",
]);

/** Whether a press was refused as the link no longer valid, rather than failing. */
export function endsTheLink(error: unknown): boolean {
  return isRefusal(error) && error.serverErrorCode !== undefined && LINK_ENDED.has(error.serverErrorCode);
}
