import "client-only";

/** The sign-in library's own sign-out, on its catch-all route. */
const SIGN_OUT_ENDPOINT = "/api/auth/sign-out";

/**
 * Ends the session this browser holds by the sign-in library's documented `POST /sign-out`, a plain request that
 * clears the cookie and renders no page, where a cookie a server action deletes renders the page it came from again.
 * A `fetch` rather than the library's client, so no frame offering the sign-out loads that client. The caller leaves
 * by a full document load, as Next's guide on preserving state has a sign-out do, so no hidden route keeps what the
 * signed-out person typed. Answers whether the session ended.
 */
export async function signOut(): Promise<boolean> {
  // A body, as the endpoint reads one; same-origin, so the browser sends the `Origin` the library's check compares.
  const answer = await fetch(SIGN_OUT_ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  return answer.ok;
}
