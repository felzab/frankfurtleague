import { asSignInIdentifier } from "@/core/emailAddress";
import { AdminReadWithoutAdministratorError } from "@/core/errors";
import { setRequestActor } from "@/core/requestScope";

import { runWithIncomingTrace } from "./traceScope";

/**
 * Runs one admin-tier read with the administrator it is made for recorded as the request's actor, the
 * backend refusing an admin-tier request that names nobody (`docs/backend/spec.md :: I41`).
 */
export async function runAdminRead<T>(fn: () => Promise<T>): Promise<T> {
  return runWithIncomingTrace(async () => {
    // Loaded at the call: every slice's `queries.ts` imports this module, public pages among their
    // readers, and a static import would put the sign-in store in each of their graphs.
    const { getAdminSession } = await import("@/core/auth");
    const session = await getAdminSession();
    // Thrown to the error boundary: a read has no failure answer to return, and only a caller outside
    // the admin guards reaches this, a programming error that must be loud.
    if (session === null) throw new AdminReadWithoutAdministratorError();

    // Recorded even where a guard already recorded an actor: `setRequestActor` refuses one that is not
    // the signed-in administrator, and a render's memoized lookup recorded nothing inside this scope.
    setRequestActor(asSignInIdentifier(session.user.email));

    return fn();
  });
}
