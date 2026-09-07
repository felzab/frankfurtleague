import { NextResponse } from "next/server";

import { APIBadStatusError, APIMalformedDataError, APINetworkError } from "@/core/errors";
import { logger } from "@/core/logging";

import { toActionErrorResult } from "./actionError";
import { runWithIncomingTrace } from "./traceScope";

import type { FormState } from "@/shared/types/types";
import type { NextRequest } from "next/server";

/**
 * What a cross-site caller is told, answered 200 with the outcome in the body as every other refusal
 * here is: on any other status `fl_frontend/src/shared/utils/publicSubmit.ts :: postPublicForm`
 * answers its own sentence and these words reach no reader.
 */
const FREMDE_HERKUNFT = "Diese Anfrage kam nicht von dieser Seite. Lade die Seite neu und versuche es noch einmal.";

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
    try {
      return await run();
    } catch (error) {
      const typed = error instanceof APIBadStatusError || error instanceof APINetworkError || error instanceof APIMalformedDataError;
      logger.error(`Public route failed: ${routeName}`, error, {
        error_code: typed ? error.code : "FE-ACT-001",
        server_error_code: error instanceof APIBadStatusError ? error.serverErrorCode : undefined,
        status: error instanceof APIBadStatusError || error instanceof APIMalformedDataError ? error.statusCode : undefined,
      });

      return toActionErrorResult(error);
    }
  });

  // Always 200: the body carries the outcome, and every other status is `postPublicForm`'s to report
  // as an answer this application never gave.
  return NextResponse.json(result);
}
