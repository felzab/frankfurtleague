import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { beforeEach, describe, it } from "node:test";

import { registerDoubles } from "@/core/exportingModule.ts";
import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import { assertEachAnswered } from "@/shared/testing/publishedRefusals.ts";

import { ZUGANG_ERTEILT } from "./constants.ts";
import { mapEntziehenRefusal, mapErteilenRefusal, mapStufeRefusal } from "./refusals.ts";

/** Work the real `after` would run behind the response, collected rather than run: no case here has a response. */
const deferred: (() => unknown)[] = [];

/* `refresh()` throws outside a request Next itself is rendering; `after` is collected. */
const NEXT_CACHE_DOUBLE = { refresh: () => undefined };
// Bound to the caller's context as Next's own `after` binds it, so a task runs inside the action's request.
const NEXT_SERVER_DOUBLE = { after: (task: () => unknown) => void deferred.push(AsyncLocalStorage.bind(task)) };

/* The real actions and their mutations, called: the request they run in and the backend client are the doubles. */
const { setSession, setFresh, signedOut } = doubleActionRequest();

registerDoubles({ specifiers: { "next/cache": NEXT_CACHE_DOUBLE, "next/server": NEXT_SERVER_DOUBLE } });

const GRANT_ID = "6890a1b2c3d4e5f6071b0001";

/** The trace and the actor each call went out under: the action's, or the scope behind its answer. */
const traces: { endpoint: string; trace: string | undefined; actor: string | undefined }[] = [];

const NOTHING_CLAIMED = { acknowledged: 1, beanspruchung: null, beansprucht_bis: null, aenderungen: [], empfaenger: [], uebersprungen: 0 };

const client = doubleApiAnswers(({ endpoint, method }) => {
  traces.push({ endpoint, trace: getRequestTraceId(), actor: getRequestActor()?.email });
  if (endpoint === "/berechtigungen/abgleich") return Promise.resolve(NOTHING_CLAIMED);
  return Promise.resolve(method === "POST" ? { acknowledged: 1, created_id: GRANT_ID } : { acknowledged: 1, berechtigung_id: GRANT_ID });
});

const { deleteBerechtigungAction, patchBerechtigungAction, postBerechtigungAction } = await import("./actions.ts");
const { getRequestActor, getRequestTraceId } = await import("@/core/requestScope.ts");

const MINUTE_MS = 60 * 1000;

beforeEach(() => {
  deferred.length = 0;
  traces.length = 0;
  setFresh(true);
});

describe("the grant", () => {
  it("sends the address as typed and schedules the announcement behind the answer", async () => {
    const result = await postBerechtigungAction({ email: "Neu@Schule.de" });

    assert.equal(result.success, true);
    assert.deepEqual(
      requestsOf(client.calls).map(({ endpoint, method, body }) => [method, endpoint, body]),
      [["POST", "/berechtigungen", { email: "Neu@Schule.de" }]],
    );
    // Scheduled and not run: announcing inside the press would hold the answer on a claim and every mail.
    assert.equal(deferred.length, 1, "the grant scheduled no announcement, or more than one");
  });

  it("answers every refusal the grant publishes through its mapper, and announces nothing", async () => {
    await assertEachAnswered({
      operation: "POST /berechtigungen",
      refuseWith: client.answerWith,
      act: () => postBerechtigungAction({ email: "neu@schule.de" }),
      mapped: mapErteilenRefusal,
    });
    assert.deepEqual(deferred, [], "a refused grant scheduled an announcement");
  });

  /* A session the address made before the grant administers nothing, every guard holding it against the
     grant's own time (`docs/frontend/spec.md :: I470`), so the grant signs nobody out and its sign-in stands. */
  it("ends no session, and answers the grant in its own words", async () => {
    const result = await postBerechtigungAction({ email: "Neu@Schule.de" });

    assert.equal("message" in result && result.message, ZUGANG_ERTEILT);
    assert.deepEqual(signedOut(), []);
  });

  /* The sign-in library's own rule, which the address box's is wider than: a grant past it admits nobody. */
  it("sends no grant to an address the sign-in library would refuse", async () => {
    const result = await postBerechtigungAction({ email: "a!b@schule.de" });

    assert.equal(result.success, false);
    assert.deepEqual(client.calls, []);
  });
});

/* The task is the pass itself, and it runs in no request: Next's `after` carries the action's scope
   into it, whose deadline the response has spent, and a cut send holds its row for the whole lease. */
describe("the announcement a change schedules", () => {
  for (const [name, act] of [
    ["grant", () => postBerechtigungAction({ email: "neu@schule.de" })],
    ["revoke", () => deleteBerechtigungAction({ id: GRANT_ID })],
    ["tier change", () => patchBerechtigungAction({ id: GRANT_ID, verwaltung: "owner" })],
  ] as const) {
    it(`runs the claim behind the ${name}'s answer, outside the action's request`, async () => {
      assert.equal((await act()).success, true);
      const [write] = traces;
      assert.ok(write?.actor !== undefined, "the action ran under no actor, so the case below proves nothing");

      await Promise.all(deferred.map((task) => task()));

      // The trace joins the claim to the change; the actor would sign the system's claim as the administrator's.
      assert.deepEqual(traces.slice(1), [{ endpoint: "/berechtigungen/abgleich", trace: write.trace, actor: undefined }]);
    });
  }
});

describe("the revoke", () => {
  it("removes the grant by its id and schedules the announcement behind the answer", async () => {
    const result = await deleteBerechtigungAction({ id: GRANT_ID });

    assert.equal(result.success, true);
    assert.deepEqual(
      requestsOf(client.calls).map(({ endpoint, method }) => [method, endpoint]),
      [["DELETE", `/berechtigungen/${GRANT_ID}`]],
    );
    assert.equal(deferred.length, 1);
  });

  it("answers every refusal the revoke publishes through its mapper, and announces nothing", async () => {
    await assertEachAnswered({
      operation: "DELETE /berechtigungen/{berechtigung_id}",
      refuseWith: client.answerWith,
      act: () => deleteBerechtigungAction({ id: GRANT_ID }),
      mapped: mapEntziehenRefusal,
    });
    assert.deepEqual(deferred, []);
  });
});

describe("the tier change", () => {
  it("sends the tier alone to the grant's path and schedules the announcement behind the answer", async () => {
    const result = await patchBerechtigungAction({ id: GRANT_ID, verwaltung: "owner" });

    assert.deepEqual(result, { success: true, message: "Diese Adresse ist jetzt Inhaber der Verwaltung." });
    assert.deepEqual(
      requestsOf(client.calls).map(({ endpoint, method, body }) => [method, endpoint, body]),
      [["PATCH", `/berechtigungen/${GRANT_ID}`, { verwaltung: "owner" }]],
    );
    assert.equal(deferred.length, 1, "the tier change scheduled no announcement, or more than one");
  });

  /* The backend answers a press naming the tier the grant holds as done, so a second press after an
     answer that never arrived reads as the success it is rather than as an error. */
  it("answers a press repeated on a tier already held as done, in the tier's own words", async () => {
    for (let press = 1; press <= 2; press += 1) {
      assert.deepEqual(await patchBerechtigungAction({ id: GRANT_ID, verwaltung: "administration" }), {
        success: true,
        message: "Diese Adresse ist nicht mehr Inhaber der Verwaltung und behält den Zugang.",
      });
    }
  });

  /* The tier is read on every request, so nobody's session needs ending for the next request to hold it. */
  it("ends no session", async () => {
    await patchBerechtigungAction({ id: GRANT_ID, verwaltung: "owner" });

    assert.deepEqual(signedOut(), []);
  });

  it("answers every refusal the tier change publishes through its mapper, and announces nothing", async () => {
    await assertEachAnswered({
      operation: "PATCH /berechtigungen/{berechtigung_id}",
      refuseWith: client.answerWith,
      act: () => patchBerechtigungAction({ id: GRANT_ID, verwaltung: "administration" }),
      mapped: mapStufeRefusal,
    });
    assert.deepEqual(deferred, []);
  });

  it("sends nothing for a tier the grant cannot hold", async () => {
    const result = await patchBerechtigungAction({ id: GRANT_ID, verwaltung: "vorstand" as "owner" });

    assert.equal(result.success, false);
    assert.deepEqual(client.calls, []);
  });
});

describe("the window all three are held to", () => {
  /* Five minutes, not the step-up's two hours (`docs/frontend/spec.md :: I458`). The standing window
     still holds here, which is what makes the case about the narrow one. */
  it("refuses each from a session confirmed six minutes ago, sending nothing", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    setSession({ user: { email: "vorstand@example.org" } });
    // The doubled store stamps the session as it first serves it, which is now.
    assert.equal((await postBerechtigungAction({ email: "neu@schule.de" })).success, true);
    client.calls.length = 0;

    t.mock.timers.tick(6 * MINUTE_MS);
    const erteilt = await postBerechtigungAction({ email: "neu@schule.de" });
    const entzogen = await deleteBerechtigungAction({ id: GRANT_ID });
    const geaendert = await patchBerechtigungAction({ id: GRANT_ID, verwaltung: "owner" });

    for (const refused of [erteilt, entzogen, geaendert]) {
      assert.equal(refused.success, false);
      assert.equal("stepUp" in refused && refused.stepUp, true, "the refusal does not ask the page to confirm");
    }
    assert.deepEqual(client.calls, [], "a stale session reached the backend");
  });

  it("sends each from a session confirmed four minutes ago", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: 2_000_000 });
    setSession({ user: { email: "vorstand@example.org" } });
    assert.equal((await postBerechtigungAction({ email: "neu@schule.de" })).success, true);

    t.mock.timers.tick(4 * MINUTE_MS);

    assert.equal((await deleteBerechtigungAction({ id: GRANT_ID })).success, true);
    assert.equal((await patchBerechtigungAction({ id: GRANT_ID, verwaltung: "owner" })).success, true);
  });
});
