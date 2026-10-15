import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { cacheCalls, doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";

import type { FLPatchSaisonTeamKontaktePayload } from "./schemas.ts";

/* The real actions over their real `mutations.ts`: the client they send through, the session and the
   request are the doubles. A file of its own, `actions.test.ts` and `editor.test.ts` replacing this
   slice's actions module for the components they render. */
const VORSTAND = { user: { email: "vorstand@example.org" } };
const { setSession } = doubleActionRequest({ session: VORSTAND });

const { calls: sent } = doubleApiAnswers(async () => blockAnswer);

const { patchSaisonTeamKontakteAction } = await import("./actions.ts");
const { ADMIN_FORBIDDEN } = await import("@/shared/utils/adminMutation.ts");

const TEAM_ID = "507f1f77bcf86cd799439011";
const SAISON_ID = "2526";

/** The block's own answer: the seats as stored and the token of the block this save left. */
let blockAnswer: Record<string, unknown> = {};

/** A block cleared whole, which every label check admits without a read, so the save reaches the client. */
const CLEARED: FLPatchSaisonTeamKontaktePayload = { team_id: TEAM_ID, saison_id: SAISON_ID, kontakte: null, kontakte_stand: "9f2c" };

beforeEach(() => {
  blockAnswer = {
    acknowledged: 1,
    saison_id: SAISON_ID,
    team_id: TEAM_ID,
    saison_team_id: "c".repeat(24),
    kontakte: null,
    kontakte_stand: "a1b2",
    bestaetigungen: [],
  };
});

describe("what the season's contacts save sends", () => {
  /* Both ids in the PATH: a backend payload model that saw one refuses the whole body. */
  it("addresses the junction row by its natural key and sends the block alone", async () => {
    await patchSaisonTeamKontakteAction(CLEARED);

    assert.deepEqual(requestsOf(sent), [
      {
        endpoint: `/teams/${TEAM_ID}/saisons/${SAISON_ID}/kontakte`,
        method: "PATCH",
        body: { kontakte: null, kontakte_stand: "9f2c" },
      },
    ]);
  });

  /* The whole block or nothing. A partial send would leave the row holding one half of a Kenntnisnahme,
     which is why the field is required with no default on either side. */
  it("refuses a body without the block, and sends a cleared one as null", async () => {
    const { kontakte: _omitted, ...withoutBlock } = CLEARED;

    const refused = await patchSaisonTeamKontakteAction(withoutBlock as FLPatchSaisonTeamKontaktePayload);
    assert.equal(refused.success, false, "a save that forgot the block was sent");
    assert.deepEqual(sent, [], "a save that forgot the block reached the client, where a default writes one");

    await patchSaisonTeamKontakteAction(CLEARED);
    assert.deepEqual(
      requestsOf(sent).map(({ body }) => body),
      [{ kontakte: null, kontakte_stand: "9f2c" }],
    );
  });

  /* The session first, because `runAdminMutation` seeds the scope the actor header is read from, then
     the parse, then the write, then the acknowledgement. */
  it("sends nothing without a session or over a body its parse refuses, and reports an unacknowledged save", async () => {
    setSession(null);
    assert.deepEqual(await patchSaisonTeamKontakteAction(CLEARED), { success: false, error: ADMIN_FORBIDDEN });
    assert.deepEqual(sent, [], "the save reached the client for a request with no session");

    setSession(VORSTAND);
    const malformed = await patchSaisonTeamKontakteAction({ ...CLEARED, team_id: "kein-team" });
    assert.equal(malformed.success, false, "a malformed club id was saved");
    assert.deepEqual(sent, [], "a body the parse refuses reached the client");

    blockAnswer = { ...blockAnswer, acknowledged: 0 };
    const unacknowledged = await patchSaisonTeamKontakteAction(CLEARED);
    assert.equal(sent.length, 1, "the acknowledged control sent nothing, so the answer below is judged over no write");
    assert.equal(unacknowledged.success, false, "an unacknowledged save reports success");
  });

  it("hands the editor the token of the block the save left", async () => {
    const result = await patchSaisonTeamKontakteAction(CLEARED);

    assert.equal("saison_team" in result ? result.saison_team?.kontakte_stand : undefined, "a1b2");
  });
});

describe("what the contacts save clears", () => {
  /* No cached read holds a contact person: the memberships read is admin-tier and memoised per render
     pass, the public team reads carry no `kontakte`, and the log is uncached. */
  it("moves no tag, and re-reads the page the save stands on", async () => {
    await patchSaisonTeamKontakteAction(CLEARED);

    assert.equal(sent.length, 1, "the save never reached the client, so what it clears is judged over nothing");
    assert.deepEqual(cacheCalls, [{ name: "refresh", args: [] }]);
  });
});
