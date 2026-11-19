import { asRefusal, isRuleRefusal } from "@/core/errors";

import type { Code } from "@/core/generated/client/types";

/**
 * Whether a refused link read means the dead link rather than a failed read. Every state a live or ended change can be
 * in answers in a 200, so a refusal is a token nothing could place, and a token the backend will not parse matches no
 * record.
 */
export function readsAsDeadLink(error: unknown): boolean {
  return asRefusal(error)?.serverErrorCode === "payload_refused" || isRuleRefusal(error);
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
