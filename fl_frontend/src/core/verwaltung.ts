import "server-only";

import { asSignInIdentifier } from "./emailAddress";
import { lookUpSubjekt } from "./signInGate";

import type { FLSubjektResponse } from "./schemas";

/**
 * The grant an address holds, read per request and never stamped on a session, which a revoke made
 * in the database would outlive (`docs/frontend/spec.md :: I121`). Throws on every backend failure:
 * each reader decides what an unread grant means.
 */
export async function verwaltungOf(email: string): Promise<FLSubjektResponse["verwaltung"]> {
  // Folded here because the library folds only CASE and only on the row it stores, while a grant is
  // stored folded (`fl_frontend/src/core/emailAddress.ts :: asSignInIdentifier`).
  return (await lookUpSubjekt(asSignInIdentifier(email))).verwaltung;
}
