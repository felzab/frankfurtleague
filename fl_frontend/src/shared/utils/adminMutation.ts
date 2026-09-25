import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { getAdminSession } from "@/core/auth";
import { APIBadStatusError, APIMalformedDataError, APINetworkError } from "@/core/errors";
import { logger } from "@/core/logging";
import { requestOutcomeUnknown } from "@/core/requestScope";

import { toActionErrorResult, unansweredAction } from "./actionError";
import { runWithIncomingTrace } from "./traceScope";
import { VALIDATION_FAILED } from "./validation";

import type { SentRequest } from "@/core/errors";
import type { ActionFailure } from "@/shared/types/types";
import type { FieldErrors } from "./validation";

/**
 * What every admin write answers when the session carries no admin role. It becomes `FormState.error` and reaches a
 * toast, so it names the admin's only remedy rather than the role that is absent.
 */
export const ADMIN_FORBIDDEN = "Deine Sitzung hat keine Administratorrechte. Melde Dich neu an.";

/** The administrator a guarded body runs for, as the guard resolved them. */
export type AdminSession = NonNullable<Awaited<ReturnType<typeof getAdminSession>>>;

/**
 * A slice's mapped refusal as the failure an action returns.
 *
 * The fallback is here rather than at each return: a mapper answering a field message and no
 * sentence renders a toast with an empty body wherever one is left out.
 */
export function refusalResult(refusal: { error?: string; fieldErrors?: FieldErrors }): ActionFailure {
  return { success: false, error: refusal.error ?? VALIDATION_FAILED, fieldErrors: refusal.fieldErrors };
}

/**
 * What the spine answers: the caller turned away by the guard, or the body's own answer. A type rather than
 * `ADMIN_FORBIDDEN`'s words, so a route choosing its status on it cannot mistake a body's failure for the guard's.
 */
export type Guarded<T> = { forbidden: true } | { forbidden: false; answer: T | ActionFailure };

/**
 * Seeds the request scope with the edge-minted trace id, and converts a thrown API error into the caller's result
 * — without which Next redacts the throw to a digest and an ordinary 409 replaces the admin's toast with the error page.
 */
async function runGuarded<T extends { success: boolean }>(
  mutationName: string,
  { readOnly }: Pick<SentRequest, "readOnly">,
  fn: (session: AdminSession) => Promise<T>,
): Promise<Guarded<T>> {
  return runWithIncomingTrace(async () => {
    let answer: T | ActionFailure;
    // Set once the guard admits the caller: a throw before then, the session store's among them, wrote nothing.
    let admitted = false;
    try {
      // Ahead of the body rather than inside each one, so no admin write reaches its payload or the
      // backend unguarded: the proxy's matcher is the first layer, and this the second (`docs/frontend/spec.md :: I7`).
      const session = await getAdminSession();
      if (session === null) return { forbidden: true };

      admitted = true;
      answer = await fn(session);
    } catch (error) {
      // A framework control-flow throw (redirect(), notFound()) is a navigation rather than a failure.
      unstable_rethrow(error);

      const typed = error instanceof APIBadStatusError || error instanceof APINetworkError || error instanceof APIMalformedDataError;
      logger.error(`Admin mutation failed: ${mutationName}`, error, {
        error_code: typed ? error.code : "FE-ACT-001",
        server_error_code: error instanceof APIBadStatusError ? error.serverErrorCode : undefined,
        status: error instanceof APIBadStatusError || error instanceof APIMalformedDataError ? error.statusCode : undefined,
      });

      // A server action is a POST whatever it does, so its declaration is what tells the two apart, and a body
      // that never ran is a read whatever it declared.
      answer = toActionErrorResult(error, { method: "POST", readOnly: readOnly || !admitted });
    }

    // Whatever the action made of a deadline's cut or of a mail that may have gone, a fan-out settling
    // either among its refusals: part of the write may stand (`docs/frontend/spec.md :: I366`).
    if (!readOnly && requestOutcomeUnknown()) {
      logger.error(`Admin mutation of unknown outcome: ${mutationName}`, undefined, { error_code: "FE-NET-001" });

      return { forbidden: false, answer: unansweredAction() };
    }

    return { forbidden: false, answer };
  });
}

/** A server action's spine; a route handler's write takes `runAdminRouteWrite`. */
export async function runAdminMutation<T extends { success: boolean }>(
  mutationName: string,
  // Required at every call: a throw after a write may leave its row standing, a read's changed nothing,
  // and a default would answer one of them wrongly. A write's success refreshes the page; a read's moves nothing.
  { readOnly }: Pick<SentRequest, "readOnly">,
  fn: (session: AdminSession) => Promise<T>,
): Promise<T | ActionFailure> {
  const guarded = await runGuarded(mutationName, { readOnly: readOnly }, async (session) => {
    const answer = await fn(session);
    // Here rather than in each action, whatever tags it also moves: an action that forgets it leaves the admin's
    // page standing (`docs/frontend/spec.md :: I233`). An action whose failure stands behind a landed write
    // refreshes on that path itself.
    if (!readOnly && answer.success) refresh();

    return answer;
  });

  return guarded.forbidden ? { success: false, error: ADMIN_FORBIDDEN } : guarded.answer;
}

/**
 * `runAdminMutation` for a route handler's write, which Next refuses `refresh()` in: the caller invalidates its own
 * tags, and the browser's dispatch refreshes the page. The guard's refusal comes back typed, the route choosing its
 * status on it.
 */
export async function runAdminRouteWrite<T extends { success: boolean }>(
  mutationName: string,
  fn: (session: AdminSession) => Promise<T>,
): Promise<Guarded<T>> {
  return runGuarded(mutationName, { readOnly: false }, fn);
}
