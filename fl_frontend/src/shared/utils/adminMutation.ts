import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { getAdminSession, isFreshlySignedIn } from "@/core/auth";
import { APIBadStatusError, APIMalformedDataError, APINetworkError, ApiUnsentError } from "@/core/errors";
import { logger } from "@/core/logging";
import { requestWriteSent } from "@/core/requestScope";

import { unansweredAction } from "./actionError";
import { runWithIncomingTrace } from "./traceScope";
import { VALIDATION_FAILED } from "./validation";
import { answerThrow, writeOutcomeUnknown } from "./writeOutcome";

import type { ActionFailure } from "@/shared/types/types";
import type { FieldErrors } from "./validation";

/**
 * What every admin write answers when the session carries no admin role. It becomes `FormState.error` and reaches a
 * toast, so it names the admin's only remedy rather than the role that is absent.
 */
export const ADMIN_FORBIDDEN = "Deine Sitzung hat keine Administratorrechte. Melde Dich neu an.";

/** The administrator a guarded body runs for, as the guard resolved them. */
export type AdminSession = NonNullable<Awaited<ReturnType<typeof getAdminSession>>>;

/** The server's answer to a change sent after the step-up window closed; the page asks before it sends one. */
const STEP_UP_REQUIRED = "Bestätige zuerst, dass Du es bist.";

/**
 * A change refused for want of a recent sign-in. `stepUp` is what the page opens the confirmation
 * on, so the sentence above is read only where the page could not ask first.
 */
export type StepUpRequired = ActionFailure & { readonly stepUp: true };

// Here under both spines rather than in `fl_frontend/src/shared/utils/kontoMutation.ts`, which builds
// on this module: the account page's refusal and an administrator's are one shape.
/** The step-up refusal, for an action judging a window of its own inside the spine's. */
export function stepUpRequired(): StepUpRequired {
  return { success: false, error: STEP_UP_REQUIRED, stepUp: true };
}

/**
 * A step-up write's refusal from a session past the step-up window, or `null`. The refresh re-reads
 * the page's own figure, so its next press asks rather than being refused again
 * (`docs/frontend/spec.md :: I433`).
 */
export function refuseUnconfirmed(session: AdminSession): StepUpRequired | null {
  if (isFreshlySignedIn(session)) return null;

  refresh();
  return stepUpRequired();
}

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

/** Which caller a spine admits, and what its log lines are filed under. */
type Guard<S> = { readonly lane: string; readonly resolve: () => Promise<S | null> };

const ADMIN_GUARD: Guard<AdminSession> = { lane: "Admin", resolve: getAdminSession };

/**
 * Seeds the request scope with the edge-minted trace id, and converts a thrown API error into the caller's result
 * — without which Next redacts the throw to a digest and an ordinary 409 replaces the admin's toast with the error page.
 */
async function runGuarded<S, T extends { success: boolean }>(
  mutationName: string,
  guard: Guard<S>,
  fn: (session: S) => Promise<T>,
): Promise<{ forbidden: true } | { forbidden: false; answer: T | ActionFailure; wrote: boolean }> {
  return runWithIncomingTrace(async () => {
    let answer: T | ActionFailure;
    try {
      // Ahead of the body rather than inside each one, so no guarded write reaches its payload or the
      // backend unguarded: for an admin write the proxy's matcher is the first layer, and this the second
      // (`docs/frontend/spec.md :: I7`).
      const session = await guard.resolve();
      if (session === null) return { forbidden: true };

      answer = await fn(session);
    } catch (error) {
      // A framework control-flow throw (redirect(), notFound()) is a navigation rather than a failure.
      unstable_rethrow(error);

      const typed = error instanceof APIBadStatusError || error instanceof APINetworkError || error instanceof APIMalformedDataError;
      logger.error(`${guard.lane} mutation failed: ${mutationName}`, error, {
        error_code: typed || error instanceof ApiUnsentError ? error.code : "FE-ACT-001",
        server_error_code: error instanceof APIBadStatusError ? error.serverErrorCode : undefined,
        status: error instanceof APIBadStatusError || error instanceof APIMalformedDataError ? error.statusCode : undefined,
      });

      // Judged by what this request sent, a server action being a POST whatever it does.
      answer = answerThrow(error);
    }

    // Read once the body has settled and inside this scope, which closes with the callback.
    const wrote = requestWriteSent();

    // Whatever the action made of it: part of the write may stand.
    if (writeOutcomeUnknown()) {
      logger.error(`${guard.lane} mutation of unknown outcome: ${mutationName}`, undefined, { error_code: "FE-NET-001" });

      return { forbidden: false, answer: unansweredAction(), wrote: wrote };
    }

    return { forbidden: false, answer: answer, wrote: wrote };
  });
}

/**
 * The spine under any guard: `forbidden` is what a caller the guard turns away is answered.
 * `runAdminMutation` is this over the administrator's guard.
 */
export async function runGuardedMutation<S, T extends { success: boolean }>(
  mutationName: string,
  guard: Guard<S> & { readonly forbidden: string },
  fn: (session: S) => Promise<T>,
): Promise<T | ActionFailure> {
  const guarded = await runGuarded(mutationName, guard, fn);
  if (guarded.forbidden) return { success: false, error: guard.forbidden };

  const { answer, wrote } = guarded;
  // Here, where no action can forget it (`docs/frontend/spec.md :: I233`). Never on a refusal, left to its
  // action where a landed write stands behind it: a refresh can remount an editor keyed on its row,
  // dropping the refused entries.
  if (wrote && (answer.success || ("outcome" in answer && answer.outcome === "unknown"))) refresh();

  return answer;
}

/** A guarded action's body, handed the administrator the guard resolved. */
type AdminBody<T> = (session: AdminSession) => Promise<T>;

/** What an action declares about its write beside its body: `stepUp` for a step-up write. */
type AdminWrite = { readonly stepUp: boolean };

/**
 * A server action's spine; a route handler's write takes `runAdminRouteWrite`. A write declaring
 * `stepUp` is refused ahead of its body from a session past the step-up window.
 */
export async function runAdminMutation<T extends { success: boolean }>(mutationName: string, fn: AdminBody<T>): Promise<T | ActionFailure>;
export async function runAdminMutation<T extends { success: boolean }>(
  mutationName: string,
  declared: AdminWrite,
  fn: AdminBody<T>,
): Promise<T | ActionFailure>;
export async function runAdminMutation<T extends { success: boolean }>(
  mutationName: string,
  ...rest: [AdminBody<T>] | [AdminWrite, AdminBody<T>]
): Promise<T | ActionFailure> {
  const [{ stepUp }, fn] = rest.length === 1 ? [{ stepUp: false }, rest[0]] : rest;

  return runGuardedMutation(
    mutationName,
    { ...ADMIN_GUARD, forbidden: ADMIN_FORBIDDEN },
    async (session) =>
      // Ahead of the body, so a stale session's step-up write reaches neither its payload nor the backend.
      (stepUp ? refuseUnconfirmed(session) : null) ?? fn(session),
  );
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
  const guarded = await runGuarded(mutationName, ADMIN_GUARD, fn);

  return guarded.forbidden ? guarded : { forbidden: false, answer: guarded.answer };
}
