// Redesign: goes with its last importer.
import { refresh, updateTag } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { logger } from "@/core/logging";
import { requestWriteSent } from "@/core/requestScope";
import { SITE_CACHE_TAG } from "@/core/siteCache";
import { runWithIncomingTrace } from "@/core/traceScope";

import { outcomeUnknown } from "./actionError";
import { logActionFailure } from "./actionFailure";
import { VALIDATION_FAILED } from "./validation";
import { answerThrow, writeOutcomeUnknown } from "./writeOutcome";

import type { ActionFailure } from "@/shared/types/types";
import type { FieldErrors } from "./validation";

/**
 * A slice's mapped refusal as the failure an action returns.
 *
 * The fallback is here rather than at each return: a mapper answering a field message and no
 * sentence renders a toast with an empty body wherever one is left out.
 */
export function refusalResult(refusal: { error?: string; fieldErrors?: FieldErrors }): ActionFailure {
  return { success: false, error: refusal.error ?? VALIDATION_FAILED, fieldErrors: refusal.fieldErrors };
}

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
): Promise<{ forbidden: true } | { forbidden: false; answer: T | ActionFailure; wrote: boolean }> {
  return runWithIncomingTrace(async () => {
    let answer: T | ActionFailure;
    try {
      // Ahead of the body rather than inside each one, so no guarded write reaches its payload or the
      // backend unguarded: for an admin write the proxy's matcher is the first layer, and this the second.
      const session = await guard.resolve();
      if (session === null) return { forbidden: true };

      answer = await fn(session);
    } catch (error) {
      // A framework control-flow throw (redirect(), notFound()) is a navigation rather than a failure.
      unstable_rethrow(error);

      logActionFailure(`${guard.lane} mutation failed: ${mutationName}`, error);

      // Judged by what this request sent, a server action being a POST whatever it does.
      answer = answerThrow(error);
    }

    // Read once the body has settled and inside this scope, which closes with the callback.
    const wrote = requestWriteSent();

    // Whatever the action made of it: part of the write may stand.
    if (writeOutcomeUnknown()) {
      logger.error("mutation.outcome_unknown", undefined, { lane: guard.lane, mutation: mutationName });

      return { forbidden: false, answer: outcomeUnknown(), wrote };
    }

    return { forbidden: false, answer, wrote };
  });
}

/** The spine under any guard: `forbidden` is what a caller the guard turns away is answered. */
export async function runGuardedMutation<S, T extends { success: boolean }>(
  mutationName: string,
  guard: Guard<S> & { readonly forbidden: string | (() => Promise<string>) },
  fn: (session: S) => Promise<T>,
): Promise<T | ActionFailure> {
  const guarded = await runGuarded(mutationName, guard, fn);
  if (guarded.forbidden) return { success: false, error: typeof guard.forbidden === "string" ? guard.forbidden : await guard.forbidden() };

  const { answer, wrote } = guarded;
  const outcome = "outcome" in answer ? answer.outcome : undefined;
  // Wherever a write may stand, a lost answer and a partial one included, and whatever it wrote: every cached read
  // carries the one tag, so no write has to know which of them it moves.
  if (wrote && (answer.success || outcome !== undefined)) updateTag(SITE_CACHE_TAG);
  // Here, where no action can forget it. Never on a refusal, left to its
  // action where a landed write stands behind it: a refresh can remount an editor keyed on its row,
  // dropping the refused entries.
  if (wrote && (answer.success || outcome === "unknown")) refresh();

  return answer;
}
