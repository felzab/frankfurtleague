import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { cacheCalls, doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiClient } from "@/shared/testing/apiClientDouble.ts";

import { describeErasureUmfang } from "./utils.ts";

const SPIELER_ID = "68c1f0a2b3c4d5e6f7a8b9c0";

/* The client doubled rather than the mutation, so the real one is called and what it asks for is
   read: the erasure and the soft retire differ by the path's suffix alone. */
const sent = doubleApiClient(() => ({ acknowledged: 1, spieler_id: SPIELER_ID, erased_saison_spieler: 3, redacted_aktionen: 7 }));

/* A file of its own: `actions.test.ts` replaces this slice's actions module for the components it
   renders, and `refusals.test.ts` doubles the mutations a request here has to reach. */
doubleActionRequest();
const { eraseSpielerAction } = await import("./actions.ts");

beforeEach(() => {
  sent.length = 0;
});

describe("what the erasure moves", () => {
  /* A DELETE on `/erasure`, never on the player's own path: that one is the soft retire. */
  it("calls the erasure endpoint and not the retire", async () => {
    await eraseSpielerAction({ id: SPIELER_ID });

    assert.deepEqual(
      sent.map(({ endpoint, method }) => ({ endpoint, method })),
      [{ endpoint: `/spieler/${SPIELER_ID}/erasure`, method: "DELETE" }],
    );
  });

  /* The base tag and nothing beside it: the person and their squad rows are what the cached public
     squad read joins, and every other cached read joins no pupil. */
  it("invalidates the spieler tag alone", async () => {
    const result = await eraseSpielerAction({ id: SPIELER_ID });

    assert.equal(result.success, true, "the erasure never landed, so its tags are judged on nothing");
    assert.deepEqual(
      cacheCalls.filter(({ name }) => name === "updateTag").map(({ args }) => args[0]),
      ["spieler"],
    );
  });

  /* Nothing can be looked up again afterwards, so the counts the endpoint answers are the only
     record of how much went, and no endpoint can honour an undo. */
  it("reports how much it removed, and offers no undo", async () => {
    const result = await eraseSpielerAction({ id: SPIELER_ID });
    const message = result.success ? (result.message ?? "") : result.error;

    assert.equal(message, describeErasureUmfang(3, 7), "the counts the endpoint answered go unreported");
    assert.doesNotMatch(message, /Rückgängig/, "the action offers an undo, and no endpoint can honour one");
  });
});
