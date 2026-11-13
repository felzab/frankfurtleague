import { serveBackend } from "@/test-support/backend.ts";
import { expect, it } from "vitest";

// Every call answered with an empty body: the cases judge what the client made of each request, not its answer.
const backend = serveBackend(() => ({}));

const { serializeQuery } = await import("./transport.ts");
const sdk = await import("./generated/client/sdk.ts");
const { requestWriteMayStand, runWithRequestScope } = await import("./requestScope.ts");

/* Every generated call's query passes through here: a null sent as "null" would filter on that word. */
it("leaves an absent value out", () => {
  expect(serializeQuery({ q: "Gymnasium", page: 2, empty: null, open: undefined })).toBe("q=Gymnasium&page=2");
});

const SPIEL_ID = "6890a1b2c3d4e5f607510001";
const SPIEL = {} as Parameters<typeof sdk.spielePatchSpiel>[1];

/** An administrator the request acts for, which an admin-tier call must name before it leaves. */
const ACTOR = { email: "vorstand@example.org", lane: "admin", authTime: 0, factor: "passkey" } as const;

/* What the contract states of a call reaches the write test through the transport the generator picked, and nothing
   fails where it does not: a read sent as a write clears the site's cache, and the fixture editor's dry run runs on
   every keystroke. Read where the action builder reads it, off the request's scope once the answer has landed. */
it.each([
  ["a write", () => sdk.spielePatchSpiel(SPIEL_ID, SPIEL, {}), true],
  ["the save's dry run", () => sdk.spielePatchSpiel(SPIEL_ID, SPIEL, { dry_run: true }), false],
  ["a base-tier read over POST", () => sdk.registrierungenPostInvitationView({ token: "t" }), false],
  ["a system-tier read over POST", () => sdk.identityGetSubject({ email: "a@schule.de" }), false],
  ["an admin-tier read over POST", () => sdk.identityGetErasureView({ email: "a@schule.de" }), false],
])("sends %s as its operation's contract states", async (_, send, standing) => {
  const mayStand = await runWithRequestScope({ traceId: "0".repeat(31) + "1", actor: ACTOR }, async () => {
    await send();
    return requestWriteMayStand();
  });

  expect(backend.sent, "the call never reached the backend, so the scope judged nothing sent").toHaveLength(1);
  expect(mayStand).toBe(standing);
});
