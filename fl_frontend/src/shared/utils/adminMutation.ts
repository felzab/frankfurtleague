import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { getAdminSession } from "@/core/auth";
import { APIBadStatusError, APIMalformedDataError, APINetworkError } from "@/core/errors";
import { logger } from "@/core/logging";
import { requestOutcomeUnknown, requestWriteSent } from "@/core/requestScope";

import { toActionErrorResult, unansweredAction } from "./actionError";
import { runWithIncomingTrace } from "./traceScope";
import { VALIDATION_FAILED } from "./validation";

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
  fn: (session: AdminSession) => Promise<T>,
): Promise<{ forbidden: true } | { forbidden: false; answer: T | ActionFailure; wrote: boolean }> {
  return runWithIncomingTrace(async () => {
    let answer: T | ActionFailure;
    try {
      // Ahead of the body rather than inside each one, so no admin write reaches its payload or the
      // backend unguarded: the proxy's matcher is the first layer, and this the second (`docs/frontend/spec.md :: I7`).
      const session = await getAdminSession();
      if (session === null) return { forbidden: true };

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

      // A server action is a POST whatever it does, so what this request sent is what tells a write's throw
      // from a read's.
      answer = toActionErrorResult(error, { method: "POST", readOnly: !requestWriteSent() });
    }

    // Read once the body has settled and inside this scope, which closes with the callback.
    const wrote = requestWriteSent();

    // Whatever the action made of a deadline's cut or of a mail that may have gone, a fan-out settling
    // either among its refusals: part of the write may stand (`docs/frontend/spec.md :: I366`).
    if (wrote && requestOutcomeUnknown()) {
      logger.error(`Admin mutation of unknown outcome: ${mutationName}`, undefined, { error_code: "FE-NET-001" });

      return { forbidden: false, answer: unansweredAction(), wrote: wrote };
    }

    return { forbidden: false, answer: answer, wrote: wrote };
  });
}

/** A server action's spine; a route handler's write takes `runAdminRouteWrite`. */
export async function runAdminMutation<T extends { success: boolean }>(
  mutationName: string,
  fn: (session: AdminSession) => Promise<T>,
): Promise<T | ActionFailure> {
  const guarded = await runGuarded(mutationName, fn);
  if (guarded.forbidden) return { success: false, error: ADMIN_FORBIDDEN };

  const { answer, wrote } = guarded;
  // Here rather than in each action, which could forget it (`docs/frontend/spec.md :: I233`), and after the
  // guard's conversions, so a throw or a deadline's cut behind a sent write refreshes too; a refusal behind
  // one is its action's to refresh.
  if (wrote && (answer.success || ("outcome" in answer && answer.outcome === "unknown"))) refresh();

  return answer;
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
  const guarded = await runGuarded(mutationName, fn);

  return guarded.forbidden ? guarded : { forbidden: false, answer: guarded.answer };
}
