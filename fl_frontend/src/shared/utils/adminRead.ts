import { getAdminSession } from "@/core/auth";
import { asSignInIdentifier } from "@/core/emailAddress";
import { getRequestActor, setRequestActor } from "@/core/requestScope";

import { runWithIncomingTrace } from "./traceScope";

/**
 * Runs one admin-tier read with the administrator it is made for recorded as the request's actor, the
 * backend refusing an admin-tier request that names nobody (`docs/backend/spec.md :: I41`).
 */
export async function runAdminRead<T>(fn: () => Promise<T>): Promise<T> {
  return runWithIncomingTrace(async () => {
    // A server action's guard has already recorded its administrator, and another session lookup
    // would cost a round trip outside a render, where `getAdminSession` memoizes nothing.
    if (getRequestActor() === undefined) {
      const session = await getAdminSession();
      // Thrown to the error boundary: a read has no failure answer to return, and only a caller outside
      // the admin guards reaches this, a programming error that must be loud.
      if (session === null) throw new Error("An admin-tier read was made for a session that is no administrator's.");

      // Recorded here and not left to the guard: a render's `getAdminSession` is memoized, so a guard
      // that resolved it outside this scope recorded nothing on it.
      setRequestActor(asSignInIdentifier(session.user.email));
    }

    return fn();
  });
}
