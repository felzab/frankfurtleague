import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { isContractBreak } from "@/core/errors";
import { logger } from "@/core/logging";
import { requestWriteSent, runAnsweringOwnCut } from "@/core/requestScope";
import { SITE_CACHE_TAG } from "@/core/siteCache";

import { isRuleRefusal, outcomeUnknown, refusedFailure } from "./actionError";
import { logActionFailure } from "./actionFailure";
import { explainsItself } from "./degradedRead";
import { UNHANDLED_FIELD_REFUSAL, UNKNOWN_REFUSAL } from "./refusal";
import { runWithIncomingTrace } from "./traceScope";
import { answerThrow, writeOutcomeUnknown } from "./writeOutcome";

import type { FormState } from "@/shared/types/types";
import type { NextRequest } from "next/server";

/**
 * What a cross-site caller is told, answered 200 with the outcome in the body as every other refusal
 * here is: on any other status `fl_frontend/src/shared/utils/publicSubmit.ts :: postPublicForm`
 * answers its own sentence and these words reach no reader.
 */
const FREMDE_HERKUNFT = `Diese Anfrage kam nicht von dieser Seite. ${UNKNOWN_REFUSAL}`;

/**
 * What a member of the public is told for a unique index's refusal, which no route maps: the shared
 * reader's sentence is the administrator's, about an entry they can open, and a public form has none.
 */
const SCHON_VORLIEGEND = "Diese Angaben liegen uns bereits vor.";

/** A route's error line, carrying the codes a thrown API error holds. */
function logRouteError(message: string, error: unknown): void {
  logActionFailure(message, error);
}

/**
 * A read after the backend ANSWERED the write, refusing or storing it, `null` where it fails: that answer settled the
 * outcome, so neither a deadline cut nor a contract break may reach the spine as an unknown one.
 */
export async function readAfterAnsweredWrite<T>(routeName: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await runAnsweringOwnCut(read);
  } catch (error) {
    if (isContractBreak(error)) logRouteError(`Public route read broke its contract after its write was answered: ${routeName}`, error);
    else if (!explainsItself(error)) logRouteError(`Public route read failed after its write was answered: ${routeName}`, error);
    return null;
  }
}

/**
 * The spine every UNAUTHENTICATED route handler shares. **Nothing here authorizes anything**: the
 * backend endpoint's own guard decides whether a write may happen.
 *
 * Deliberately not `runAdminMutation`, whose name says a session was checked.
 */
export async function handlePublicRequest<T extends { success: boolean }>(
  request: NextRequest,
  {
    routeName,
    run,
  }: {
    /** The route, for the one log line a thrown error leaves; `toActionErrorResult` names no caller. */
    routeName: string;
    run: () => Promise<T>;
  },
): Promise<NextResponse> {
  // Same-origin only, and the one CSRF-shaped defence a route with no session can have. A `null`
  // header passes deliberately: a browser too old to send it is still a reader of this page.
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite !== null && secFetchSite !== "same-origin") {
    return NextResponse.json({ success: false, error: FREMDE_HERKUNFT });
  }

  const result = await runWithIncomingTrace(async (): Promise<T | NonNullable<FormState>> => {
    let answer: T | NonNullable<FormState>;
    try {
      answer = await run();
    } catch (error) {
      logRouteError(`Public route failed: ${routeName}`, error);

      if (isRuleRefusal(error)) {
        // Any other code is a rule no mapper here words. Never the shared reader's reload: it discards the
        // entries a visitor typed, which the sentence answered promises are intact.
        return error.serverErrorCode === "DB-COMMON-002"
          ? { success: false, error: SCHON_VORLIEGEND }
          : refusedFailure(error, UNHANDLED_FIELD_REFUSAL);
      }

      // Judged by what this request sent, never by the route's own method: a POST that sent nothing changed nothing.
      answer = answerThrow(error);
    }

    if (writeOutcomeUnknown()) {
      logger.error("route.outcome_unknown", undefined, { route: routeName });
      answer = outcomeUnknown();
    }

    // Wherever the write may stand, a lost answer included, as the action spine clears it. `{ expire: 0 }`:
    // `updateTag` throws here, and the default profile serves the old entry once more.
    if (requestWriteSent() && (answer.success || ("outcome" in answer && answer.outcome !== undefined))) {
      revalidateTag(SITE_CACHE_TAG, { expire: 0 });
    }

    return answer;
  });

  // Always 200: the body carries the outcome, and every other status is `postPublicForm`'s to report
  // as an answer this application never gave.
  return NextResponse.json(result);
}
