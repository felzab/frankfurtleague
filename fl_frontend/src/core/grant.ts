import "server-only";

import { asSignInIdentifier } from "./emailAddress";
import { lookUpSubject } from "./signInGate";

import type { FLSubjectResponse } from "./generated/client/types";

/** The grant an address holds, its tier and when the grant and its `owner` tier took effect, as the subject lookup serves them: null together for none. */
export type Grant = Pick<FLSubjectResponse, "admin_tier" | "granted_since" | "owner_since">;

const NO: Grant = { admin_tier: null, granted_since: null, owner_since: null };

/**
 * The grant an address holds, read per request and never stamped on a session, which a revoke made
 * in the database would outlive. Throws on every backend failure:
 * each reader decides what an unread grant means.
 */
export async function grantOf(email: string): Promise<Grant> {
  // Folded here because the library folds only CASE and only on the row it stores, while a grant is
  // stored folded (`fl_frontend/src/core/emailAddress.ts :: asSignInIdentifier`).
  const subject = await lookUpSubject(asSignInIdentifier(email));

  // A barred holder is no administrator, as the backend's actor check refuses them: a grant written in
  // the database directly is the one way onto a barred address, and it admits nothing.
  return subject.barred ? NO : { admin_tier: subject.admin_tier, granted_since: subject.granted_since, owner_since: subject.owner_since };
}

/**
 * Whether a session made at `made` is no older than `since`: a privilege holds for sessions made since it
 * alone, judged here because ending older sessions at the change misses
 * one written in the database.
 */
export function madeSince(made: Date | string, since: string | null): boolean {
  const created = new Date(made).getTime();
  const at = since === null ? Number.NaN : new Date(since).getTime();

  // An unreadable instant on either side admits nobody, as `withinLifetime` reads an unreadable stamp.
  return Number.isFinite(created) && Number.isFinite(at) && created >= at;
}

/**
 * Whether a session the administrator's guard admitted holds an owner's power: the grant `owner`, and
 * the session made since that tier took effect, where the backend judges an owner's write.
 */
export function holdsOwnersTier(made: Date | string, { admin_tier, owner_since }: Grant): boolean {
  return admin_tier === "owner" && madeSince(made, owner_since);
}
