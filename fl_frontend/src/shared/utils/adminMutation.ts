import { refresh, updateTag } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { isFreshlySignedIn, judgeAdminRequest } from "@/core/auth";
import { APIBadStatusError, APIMalformedDataError, APINetworkError, ApiUnsentError } from "@/core/errors";
import { logger } from "@/core/logging";
import { declareWriteTags, requestWriteSent, requestWriteTags } from "@/core/requestScope";
import { isWithinEnrolmentWindow } from "@/core/sessionLifetimes";

import { outcomeUnknown, ZUGANG_WEG } from "./actionError";
import { VERSUCHE_ES_ERNEUT_SATZ } from "./refusal";
import { runWithIncomingTrace } from "./traceScope";
import { VALIDATION_FAILED } from "./validation";
import { answerThrow, writeOutcomeUnknown } from "./writeOutcome";

import type { AdminRefusal, getAdminSession } from "@/core/auth";
import type { StepUpDemand } from "@/shared/components/ui/stepUp";
import type { ActionFailure } from "@/shared/types/types";
import type { FieldErrors } from "./validation";

/**
 * What an admin write answers a session a sign-in repairs: none, or one short of the administrator's
 * factor or window. It reaches a toast, so it names the remedy rather than the role that is absent.
 */
export const ADMIN_FORBIDDEN = "Deine Sitzung hat keine Administratorrechte. Melde Dich neu an.";

/** A grant the backend did not answer: nothing ran, and a sign-in would meet the same unread grant. */
const BERECHTIGUNG_UNGELESEN = "Dein Zugang zur Verwaltung ließ sich gerade nicht prüfen.";

/** What an admin write answers where the guard could not read the grant. */
const BERECHTIGUNG_UNGELESEN_ERNEUT = `${BERECHTIGUNG_UNGELESEN} ${VERSUCHE_ES_ERNEUT_SATZ}`;

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
 * A step-up write's refusal from a session past the window `demand` names, or `null`. The refresh
 * re-reads the page's own figures, so its next press asks rather than being refused again
 * (`docs/frontend/spec.md :: I433`).
 */
export function refuseUnconfirmed(session: AdminSession, demand: Exclude<StepUpDemand, false> = true): StepUpRequired | null {
  // Inside the step-up window as well: the narrow window is a stricter reading of the same confirmation.
  const confirmed = isFreshlySignedIn(session) && (demand !== "enrolment" || isWithinEnrolmentWindow(session.session.createdAt));
  if (confirmed) return null;

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
export type Guarded<T> = { forbidden: true; refused: AdminRefusal } | { forbidden: false; answer: T | ActionFailure };

/** Which caller a spine admits, and what its log lines are filed under. */
type Guard<S> = { readonly lane: string; readonly resolve: () => Promise<S | null> };

/**
 * Seeds the request scope with the edge-minted trace id, and converts a thrown API error into the caller's result
 * — without which Next redacts the throw to a digest and an ordinary 409 replaces the admin's toast with the error page.
 */
async function runGuarded<S, T extends { success: boolean }>(
  mutationName: string,
  guard: Guard<S>,
  fn: (session: S) => Promise<T>,
): Promise<{ forbidden: true } | { forbidden: false; answer: T | ActionFailure; wrote: boolean; tags: readonly string[] }> {
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
    const tags = requestWriteTags();

    // Whatever the action made of it: part of the write may stand.
    if (writeOutcomeUnknown()) {
      logger.error(`${guard.lane} mutation of unknown outcome: ${mutationName}`, undefined, { error_code: "FE-NET-001" });

      return { forbidden: false, answer: outcomeUnknown(), wrote: wrote, tags: tags };
    }

    return { forbidden: false, answer: answer, wrote: wrote, tags: tags };
  });
}

/**
 * The spine under any guard: `forbidden` is what a caller the guard turns away is answered.
 * `runAdminMutation` is this over the administrator's guard.
 */
export async function runGuardedMutation<S, T extends { success: boolean }>(
  mutationName: string,
  guard: Guard<S> & { readonly forbidden: string | (() => Promise<string>) },
  fn: (session: S) => Promise<T>,
): Promise<T | ActionFailure> {
  const guarded = await runGuarded(mutationName, guard, fn);
  if (guarded.forbidden) return { success: false, error: typeof guard.forbidden === "string" ? guard.forbidden : await guard.forbidden() };

  const { answer, wrote, tags } = guarded;
  const outcome = "outcome" in answer ? answer.outcome : undefined;
  // Wherever a write may stand, a lost answer and a partial one included: a cached public read the
  // write feeds keeps serving what it replaced for days otherwise (`docs/frontend/spec.md :: I640`).
  if (wrote && (answer.success || outcome !== undefined)) for (const tag of tags) updateTag(tag);
  // Here, where no action can forget it (`docs/frontend/spec.md :: I233`). Never on a refusal, left to its
  // action where a landed write stands behind it: a refresh can remount an editor keyed on its row,
  // dropping the refused entries.
  if (wrote && (answer.success || outcome === "unknown")) refresh();

  return answer;
}

/**
 * The cache tags a body's write feeds, declared before the write is sent: this spine, and a public
 * route's (`fl_frontend/src/shared/utils/publicRoute.ts`), drop them once the body settles, a lost
 * answer included, which a drop after the awaited write never reaches.
 */
export function invalidatesOnWrite(...tags: readonly string[]): void {
  declareWriteTags(tags);
}

/**
 * The admin guard for one call, keeping why it refused: a second read of the session to learn why is
 * another round trip, and can answer differently from the one that refused.
 */
function judgingGuard(): { readonly guard: Guard<AdminSession>; readonly verdict: { refused: AdminRefusal } } {
  const verdict: { refused: AdminRefusal } = { refused: "signIn" };
  const resolve = async (): Promise<AdminSession | null> => {
    const judged = await judgeAdminRequest();
    if ("session" in judged) return judged.session;
    verdict.refused = judged.refused;
    return null;
  };

  return { guard: { lane: "Admin", resolve }, verdict };
}

/** Each reason the guard turns an admin write away for, in the words of its remedy; a record, so a reason added to the guard is worded here. */
export const FORBIDDEN_BY_REFUSAL: Readonly<Record<AdminRefusal, string>> = {
  signIn: ADMIN_FORBIDDEN,
  // One sentence for an address holding no grant, whether it was revoked or never held: no sign-in repairs either.
  noGrant: ZUGANG_WEG,
  grantGone: ZUGANG_WEG,
  unread: BERECHTIGUNG_UNGELESEN_ERNEUT,
};

/** A guarded action's body, handed the administrator the guard resolved. */
type AdminBody<T> = (session: AdminSession) => Promise<T>;

/** What an action declares about its write beside its body: `stepUp` for a step-up write, and which window it is held to. */
type AdminWrite = { readonly stepUp: StepUpDemand };

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
  const { guard, verdict } = judgingGuard();
  // The refusal in the words naming its remedy: no grant, and a grant the backend left unread, are
  // repaired by no sign-in.
  const forbidden = () => Promise.resolve(FORBIDDEN_BY_REFUSAL[verdict.refused]);

  return runGuardedMutation(mutationName, { ...guard, forbidden }, async (session) => {
    // Ahead of the body, so a stale session's step-up write reaches neither its payload nor the backend.
    const unconfirmed = stepUp === false ? null : refuseUnconfirmed(session, stepUp);
    if (unconfirmed !== null) return unconfirmed;

    try {
      return await fn(session);
    } catch (error) {
      const refused = confirmationRefused(mutationName, error);
      refresh();
      return refused;
    }
  });
}

/** The backend's refusal of a write for want of a passkey confirmation inside the window it holds that write to. */
function isConfirmationRefused(error: unknown): error is APIBadStatusError {
  return error instanceof APIBadStatusError && error.serverErrorCode === "REQ-AUTH-009";
}

/**
 * The backend's own window refused a write a spine admitted: one declaring no step-up, or one sent at
 * the window's edge. Answered as the spine's own refusal, so the page's next press asks
 * (`docs/frontend/spec.md :: I493`).
 */
function confirmationRefused(mutationName: string, error: unknown): StepUpRequired {
  if (!isConfirmationRefused(error)) throw error;

  logger.error(`Admin mutation refused for want of a confirmation: ${mutationName}`, error, {
    error_code: error.code,
    server_error_code: error.serverErrorCode,
    status: error.statusCode,
  });
  return stepUpRequired();
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
  const { guard, verdict } = judgingGuard();
  const guarded = await runGuarded(mutationName, guard, async (session) => {
    try {
      return await fn(session);
    } catch (error) {
      return confirmationRefused(mutationName, error);
    }
  });

  return guarded.forbidden ? { forbidden: true, refused: verdict.refused } : { forbidden: false, answer: guarded.answer };
}
