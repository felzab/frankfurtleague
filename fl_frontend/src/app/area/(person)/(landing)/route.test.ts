import { person } from "@/test-support/subjectFixtures";
import { describe, expect, it, vi } from "vitest";

import { ROUTES } from "@/core/routes";

import { GET } from "./route";

/** The person each case's session read answers, or the failure it throws. */
const session = vi.hoisted(() => ({ read: (): Promise<unknown> => Promise.resolve(null) }));
vi.mock("@/core/subject", () => ({ getSubjectSession: () => session.read() }));

/** Where `/area` sends the request, as Next's redirect names it in what it throws. */
async function sentTo(): Promise<string> {
  const thrown: unknown = await GET().catch((error: unknown) => error);
  const digest = thrown instanceof Error && "digest" in thrown ? String(thrown.digest) : "";
  const [kind, , address] = digest.split(";");
  if (kind !== "NEXT_REDIRECT" || address === undefined) throw thrown;
  return address;
}

// What `/area` decides beyond `landingTargetOf` and `owesSignInStep`, whose own cases are `features/roles/utils.test.ts`'s.
describe("/area", () => {
  // Sent on to its places, the session would open a person's pages while it owes the administrator's step: the one case
  // holding that the route asks `owesSignInStep` at all.
  it("sends a granted address's session the administration refuses to the sign-in's landing", async () => {
    session.read = () => Promise.resolve(person({ admin_tier: "administration" }));
    expect(await sentTo()).toBe(ROUTES.signInLanding.path());
  });

  // A throw here would be a bare error page outside every frame, where the chooser fails into the person frame's card.
  it("sends a lookup that failed to the chooser", async () => {
    session.read = () => Promise.reject(new Error("backend down"));
    expect(await sentTo()).toBe(ROUTES.areaRoles.path());
  });
});
