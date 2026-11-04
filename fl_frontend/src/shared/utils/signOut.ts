import "client-only";

import { COPY } from "@/core/copy";

import type { SignOutResult } from "@/shared/types/types";

/** The sign-in library's own sign-out, on its catch-all route (`fl_frontend/src/app/api/auth/[...all]/route.ts`). */
const SIGN_OUT_ENDPOINT = "/api/auth/sign-out";

/** The edge's own rate refusal, which ended nothing. */
const TOO_MANY_REQUESTS = 429;

/**
 * Ends the session this browser holds by the sign-in library's documented `POST /sign-out`, a plain request that
 * clears the cookie and renders no page, where a cookie a server action deletes renders the page it came from again.
 * A `fetch` rather than the library's client, so no frame offering the sign-out loads that client. The caller leaves
 * by a full document load, as Next's guide on preserving state has a sign-out do, so no hidden route keeps what the
 * signed-out person typed.
 */
export async function signOut(): Promise<SignOutResult> {
  // A body, as the endpoint reads one; same-origin, so the browser sends the `Origin` the library's check compares.
  const answer = await fetch(SIGN_OUT_ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  if (answer.ok) return { success: true };

  // Only the edge's own refusal wrote nothing: any other answer may have come after the row was deleted.
  return answer.status === TOO_MANY_REQUESTS
    ? { success: false, error: COPY.shared.failure.tooManyAttempts }
    : { success: false, error: COPY.shared.failure.unexpected, outcome: "unknown" };
}
