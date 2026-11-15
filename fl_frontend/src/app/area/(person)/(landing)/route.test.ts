import { answerTheLookup } from "@/test-support/authDoubles";
import { serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";
import { describe, expect, it } from "vitest";

import { ROUTES } from "@/core/routes";

// No answer of its own: the route reads nothing beyond the session's lookup, so any other request fails the case.
const backend = serveBackend();
// A granted address signed in by a typed code, which holds the grant and is no administrator's session: the lane
// asks a passkey's (`fl_frontend/src/core/auth/guards.ts :: isAdminSession`).
const GRANTED_BY_CODE = {
  email: "vorstand@example.org",
  records: { admin_tier: "administration", granted_since: "2026-01-01T00:00:00Z" },
} as const;
signedInRequest(GRANTED_BY_CODE);
const { GET } = await import("./route");

/** Where `/area` sends the request, as Next's redirect names it in what it throws. */
async function sentTo(): Promise<string> {
  const thrown: unknown = await GET().catch((error: unknown) => error);
  const digest = thrown instanceof Error && "digest" in thrown ? String(thrown.digest) : "";
  const [kind, , address] = digest.split(";");
  if (kind !== "NEXT_REDIRECT" || address === undefined) throw thrown;
  return address;
}

/** What the route's session read posted to the lookup, as the backend took it. */
const lookedUp = () => backend.served.filter(({ path }) => path === "/identity/subject").map(({ body }) => body);

// What `/area` decides beyond `landingTargetOf` and `owesSignInStep`, whose own cases are `features/roles/utils.test.ts`'s.
describe("/area", () => {
  // Sent on to its places, the session would open a person's pages while it owes the administrator's step: the one case
  // holding that the route asks `owesSignInStep` at all.
  it("sends a granted address's session the administration refuses to the sign-in's landing", async () => {
    expect(await sentTo()).toBe(ROUTES.signInLanding.path());
  });

  // A throw here would be a bare error page outside every frame, where the chooser fails into the person frame's card.
  it("sends a lookup that failed to the chooser", async () => {
    // The session signed in before the case; from here the backend fails the lookup.
    answerTheLookup(() => null);
    expect(await sentTo()).toBe(ROUTES.areaRoles.path());
    // The failure was the signed-in session's lookup, which the backend failed, and no other read's.
    expect(lookedUp()).toStrictEqual([{ email: GRANTED_BY_CODE.email }]);
    expect(backend.sent).toStrictEqual([]);
  });
});
