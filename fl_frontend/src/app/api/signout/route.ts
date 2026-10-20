import { NextResponse } from "next/server";

import { isAPIError } from "better-auth/api";

import { signOutHere } from "@/core/auth";
import { logger } from "@/core/logging";
import { outcomeUnknown } from "@/shared/utils/actionError";
import { crossSiteRefusal } from "@/shared/utils/adminMutation";
import { VERSUCHE_ES_ERNEUT_SATZ } from "@/shared/utils/refusal";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import type { SignOutResult } from "@/shared/types/types";
import type { NextRequest } from "next/server";

// A route handler and never a server action (`docs/frontend/spec.md :: I831`): a cookie an action deletes makes
// Next render the page it came from again, and an area's guard turns the ended session away by unmounting its frame.
/** POST alone, so nothing a prefetch or a mail gateway fetches signs anybody out. */
export async function POST(request: NextRequest) {
  // A cross-site post would sign the reader out of this site.
  const refused = crossSiteRefusal(request);
  if (refused !== null) return refused;

  const answer = await runWithIncomingTrace(async (): Promise<SignOutResult> => {
    try {
      // The request's own cookie names the session; `nextCookies()` writes the cleared one onto this response.
      await signOutHere(request.headers);
      return { success: true };
    } catch (error) {
      // The library's own refusal, raised before it reached the row.
      if (isAPIError(error)) return { success: false, error: VERSUCHE_ES_ERNEUT_SATZ };

      // Anything else may have come after the row was deleted, so neither answer above is true of it. The NAME
      // alone: a failure on this path may carry the session's own token.
      logger.error("auth.sign_out_failed", undefined, { error_code: "FE-ACT-001", name: error instanceof Error ? error.name : "unknown" });
      return outcomeUnknown();
    }
  });

  // 200 for every answer this application decided, which is what `postPublicForm` tells an edge's answer apart by.
  return NextResponse.json(answer);
}
