import { doubleApiClient } from "@/test-support/apiClientDouble.ts";
import { expect, it } from "vitest";

// Replaced at the module boundary, before the client loads: the real one reaches a backend no test process runs.
const calls = doubleApiClient(() => ({}));

const { serializeQuery } = await import("./transport.ts");
const sdk = await import("./generated/client/sdk.ts");

/* Every generated call's query passes through here: a list sent as one joined value would reach FastAPI as a single
   unknown member and refuse the read, and a null sent as "null" would filter on that word. */
it("sends a list as one key per value and leaves an absent value out", () => {
  expect(serializeQuery({ status: ["eingereicht", "zugesagt"], q: "Gymnasium", page: 2, empty: null, open: undefined })).toBe(
    "status=eingereicht&status=zugesagt&q=Gymnasium&page=2",
  );
});

const SPIEL_ID = "6890a1b2c3d4e5f607510001";
const SPIEL = {} as Parameters<typeof sdk.spielePatchSpiel>[1];

/* What the contract states of a call reaches the write test through the transport the generator picked, and nothing
   fails where it does not: a read sent as a write clears the site's cache, and the fixture editor's dry run runs on
   every keystroke. */
it.each([
  ["a write", () => sdk.spielePatchSpiel(SPIEL_ID, SPIEL, {}), undefined],
  ["the save's dry run", () => sdk.spielePatchSpiel(SPIEL_ID, SPIEL, { dry_run: true }), true],
  ["a base-tier read over POST", () => sdk.registrierungenPostInvitationView({ token: "t" }), true],
  ["a system-tier read over POST", () => sdk.identityGetSubject({ email: "a@schule.de" }), true],
  ["an admin-tier read over POST", () => sdk.identityGetErasureView({ email: "a@schule.de" }), true],
])("sends %s as its operation's contract states", async (_, send, readOnly) => {
  calls.length = 0;
  await send();

  expect(calls.map((call) => call.readOnly)).toStrictEqual([readOnly]);
});
