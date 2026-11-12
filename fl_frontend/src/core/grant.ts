import "server-only";

import { asSignInIdentifier } from "./emailAddress";
import { lookUpSubject } from "./signInGate";

import type { FLSubjectResponse } from "./generated/client/types";

/** The grant an address holds in effect, its tier and when it took effect, as the subject lookup serves them: null together for none. */
export type Grant = Pick<FLSubjectResponse, "admin_tier" | "granted_since">;

/**
 * The grant an address holds, read per request and never stamped on a session, which a removal or a
 * handover would outlive. Throws on every backend failure: each reader decides what an unread grant means.
 */
export async function grantOf(email: string): Promise<Grant> {
  // Folded here because the library folds only case and only on the row it stores, while a grant is
  // stored folded.
  const { admin_tier, granted_since } = await lookUpSubject(asSignInIdentifier(email));

  return { admin_tier, granted_since };
}

/**
 * Whether a session made at `made` is no older than `since`: a privilege holds for sessions made since it
 * alone, judged here because ending older sessions at the change misses one written in the database.
 */
export function madeSince(made: Date | string, since: string | null): boolean {
  const created = new Date(made).getTime();
  const at = since === null ? Number.NaN : new Date(since).getTime();

  // An unreadable instant on either side admits nobody.
  return Number.isFinite(created) && Number.isFinite(at) && created >= at;
}
