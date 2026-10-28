import { cacheCalls, doubleActionRequest } from "@/test-support/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/test-support/apiClientDouble.ts";
import { beforeEach, describe, expect, it } from "vitest";

import type { FLPatchSaisonTeamKontaktePayload } from "./schemas.ts";

/* The real actions over their real `mutations.ts`: the client they send through, the session and the
   request are the doubles. */
const VORSTAND = { user: { email: "vorstand@example.org" } };
const { setSession } = doubleActionRequest({ session: VORSTAND });

const { calls: sent } = doubleApiAnswers(async () => blockAnswer);

const { patchSaisonTeamKontakteAction } = await import("./actions.ts");
const { ANMELDUNG_ABGELAUFEN } = await import("@/shared/utils/actionError.ts");

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
    abgaenge: [],
  };
});

describe("what the season's contacts save sends", () => {
  /* Both ids in the PATH: a backend payload model that saw one refuses the whole body. */
  it("addresses the junction row by its natural key and sends the block alone", async () => {
    await patchSaisonTeamKontakteAction(CLEARED);

    expect(requestsOf(sent)).toStrictEqual([
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
    expect(refused.success, "a save that forgot the block was sent").toBe(false);
    expect(sent, "a save that forgot the block reached the client, where a default writes one").toStrictEqual([]);

    await patchSaisonTeamKontakteAction(CLEARED);
    expect(requestsOf(sent).map(({ body }) => body)).toStrictEqual([{ kontakte: null, kontakte_stand: "9f2c" }]);
  });

  /* The session first, because `runAdminMutation` seeds the scope the actor header is read from, then
     the parse, then the write, then the acknowledgement. */
  it("sends nothing without a session or over a body its parse refuses, and reports an unacknowledged save", async () => {
    setSession(null);
    expect(await patchSaisonTeamKontakteAction(CLEARED)).toStrictEqual({ success: false, error: ANMELDUNG_ABGELAUFEN });
    expect(sent, "the save reached the client for a request with no session").toStrictEqual([]);

    setSession(VORSTAND);
    const malformed = await patchSaisonTeamKontakteAction({ ...CLEARED, team_id: "kein-team" });
    expect(malformed.success, "a malformed club id was saved").toBe(false);
    expect(sent, "a body the parse refuses reached the client").toStrictEqual([]);

    blockAnswer = { ...blockAnswer, acknowledged: 0 };
    const unacknowledged = await patchSaisonTeamKontakteAction(CLEARED);
    expect(sent.length, "the acknowledged control sent nothing, so the answer below is judged over no write").toBe(1);
    expect(unacknowledged.success, "an unacknowledged save reports success").toBe(false);
  });

  it("hands the editor the token of the block the save left", async () => {
    const result = await patchSaisonTeamKontakteAction(CLEARED);

    expect("saison_team" in result ? result.saison_team?.kontakte_stand : undefined).toBe("a1b2");
  });
});

describe("what the contacts save clears", () => {
  /* No cached read holds a contact person: the memberships read is admin-tier and memoised per render
     pass, the public team reads carry no `kontakte`, and the log is uncached. */
  it("moves no tag, and re-reads the page the save stands on", async () => {
    await patchSaisonTeamKontakteAction(CLEARED);

    expect(sent.length, "the save never reached the client, so what it clears is judged over nothing").toBe(1);
    expect(cacheCalls).toStrictEqual([{ name: "refresh", args: [] }]);
  });
});
