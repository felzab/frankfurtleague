import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

import { cacheCalls, doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiClient } from "@/shared/testing/apiClientDouble.ts";

import type { FLKontaktErasureResponse, FLPatchSaisonTeamKontaktePayload } from "./schemas.ts";

/* The real actions over their real `mutations.ts`: the client they send through, the session and the
   request are the doubles. A file of its own, `actions.test.ts` and `editor.test.ts` replacing this
   slice's actions module for the components they render. */
doubleActionRequest();

/** What each endpoint answers, parsed by the schema the mutation hands over as the real client parses it. */
const sent = doubleApiClient(({ endpoint }, schema) => schema.parse(endpoint === "/kontakte/erasure" ? ERASURE : blockAnswer));

/** Each request the client was handed, its body parsed. */
const bodiesParsed = () =>
  sent.map(({ endpoint, method, body, params }) => ({
    endpoint,
    method,
    body: body === undefined ? undefined : (JSON.parse(body) as unknown),
    params,
  }));

const recorders = globalThis as unknown as Record<string, unknown>;

const AUTH = `export const getAdminSession = async () => globalThis.__flKontakteSession;`;

// Registered after the request's doubles, so each of these answers before theirs.
registerHooks({
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/auth.ts")) return { format: "module", source: AUTH, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { eraseKontaktpersonAction, patchSaisonTeamKontakteAction } = await import("./actions.ts");
const { ADMIN_FORBIDDEN } = await import("@/shared/utils/adminMutation.ts");
const { describeKontaktErasureUmfang } = await import("./utils.ts");

const TEAM_ID = "507f1f77bcf86cd799439011";
const SAISON_ID = "2526";
const ADDRESS = "ada@example.org";

/** Counts naming no person, as the endpoint answers them. */
const ERASURE: FLKontaktErasureResponse = {
  acknowledged: 1,
  cleared_saison_teams: 1,
  cleared_bewerbungen: 2,
  cleared_kontakt_slots: 3,
  redacted_aktionen: 4,
};

/** The block's own answer: the seats as stored and the token of the block this save left. */
let blockAnswer: Record<string, unknown> = {};

/** A block cleared whole, which every label check admits without a read, so the save reaches the client. */
const CLEARED: FLPatchSaisonTeamKontaktePayload = { team_id: TEAM_ID, saison_id: SAISON_ID, kontakte: null, kontakte_stand: "9f2c" };

beforeEach(() => {
  sent.length = 0;
  recorders.__flKontakteSession = { user: { email: "vorstand@example.org" } };
  blockAnswer = { acknowledged: 1, saison_id: SAISON_ID, team_id: TEAM_ID, kontakte: null, kontakte_stand: "a1b2" };
});

describe("what the person's erasure sends", () => {
  /* The address travels in the BODY. A path or a query segment would file it in the access log, in
     nginx's log and in `aktionen.request.path` — three fresh copies of the value being destroyed. */
  it("sends the address in the body, to the erasure endpoint, as a POST", async () => {
    await eraseKontaktpersonAction({ email: ADDRESS });

    assert.deepEqual(bodiesParsed(), [{ endpoint: "/kontakte/erasure", method: "POST", body: { email: ADDRESS }, params: undefined }]);
  });

  /* The response carries counts and no person, and nothing on this side may put one back. */
  it("reports the counts and never the address", async () => {
    const result = await eraseKontaktpersonAction({ email: ADDRESS });

    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal("message" in result ? result.message : undefined, describeKontaktErasureUmfang(ERASURE));
    assert.ok(!JSON.stringify(result).includes(ADDRESS), "the action's answer carries the address it erased");
  });

  /* `POST /kontakte/erasure` refuses NOTHING, so an address matching nobody succeeds and clears zero:
     the count is what lets the panel tell a miss from a deletion. */
  it("counts what an erasure cleared", async () => {
    const result = await eraseKontaktpersonAction({ email: ADDRESS });

    assert.equal("cleared" in result ? result.cleared : undefined, ERASURE.cleared_kontakt_slots + ERASURE.redacted_aktionen);
  });
});

describe("what the season's contacts save sends", () => {
  /* Both ids in the PATH: a backend payload model that saw one refuses the whole body. */
  it("addresses the junction row by its natural key and sends the block alone", async () => {
    await patchSaisonTeamKontakteAction(CLEARED);

    assert.deepEqual(bodiesParsed(), [
      {
        endpoint: `/teams/${TEAM_ID}/saisons/${SAISON_ID}/kontakte`,
        method: "PATCH",
        body: { kontakte: null, kontakte_stand: "9f2c" },
        params: undefined,
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
      bodiesParsed().map(({ body }) => body),
      [{ kontakte: null, kontakte_stand: "9f2c" }],
    );
  });

  /* The session first, because `runAdminMutation` seeds the scope the actor header is read from, then
     the parse, then the write, then the acknowledgement. */
  it("sends nothing without a session or over a body its parse refuses, and reports an unacknowledged save", async () => {
    recorders.__flKontakteSession = null;
    assert.deepEqual(await patchSaisonTeamKontakteAction(CLEARED), { success: false, error: ADMIN_FORBIDDEN });
    assert.deepEqual(sent, [], "the save reached the client for a request with no session");

    recorders.__flKontakteSession = { user: { email: "vorstand@example.org" } };
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

describe("what the contacts writes clear", () => {
  /* No cached read holds a contact person: the memberships read is admin-tier and memoised per render
     pass, the public team reads carry no `kontakte`, and the applications and the log are uncached. */
  it("moves no tag, and re-reads the page each write stands on", async () => {
    await eraseKontaktpersonAction({ email: ADDRESS });
    await patchSaisonTeamKontakteAction(CLEARED);

    assert.equal(sent.length, 2, "a write never reached the client, so what it clears is judged over nothing");
    assert.deepEqual(
      cacheCalls.map(({ name }) => name),
      ["refresh", "refresh"],
    );
  });
});
