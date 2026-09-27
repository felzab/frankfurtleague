import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

import { exportingModule } from "@/core/exportingModule.ts";
import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import { assertEachAnswered } from "@/shared/testing/publishedRefusals.ts";

import { mapEntziehenRefusal, mapErteilenRefusal } from "./refusals.ts";

/** Work the real `after` would run behind the response, collected rather than run: no case here has a response. */
const deferred: (() => unknown)[] = [];

/* `refresh()` throws outside a request Next itself is rendering; `after` is collected. */
const NEXT_CACHE_DOUBLE = exportingModule({ refresh: () => undefined });
// Bound to the caller's context as Next's own `after` binds it, so a task runs inside the action's request.
const NEXT_SERVER_DOUBLE = exportingModule({ after: (task: () => unknown) => void deferred.push(AsyncLocalStorage.bind(task)) });

/* The real actions and their mutations, called: the request they run in and the backend client are the doubles. */
const { setSession, setFresh, signedOut, failSignOut } = doubleActionRequest();

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/cache") return { url: `data:text/javascript,${encodeURIComponent(NEXT_CACHE_DOUBLE)}`, shortCircuit: true };
    if (specifier === "next/server") return { url: `data:text/javascript,${encodeURIComponent(NEXT_SERVER_DOUBLE)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const GRANT_ID = "6890a1b2c3d4e5f6071b0001";

/** The trace each call went out under: the action's own, or none for work run outside any request. */
const traces: { endpoint: string; trace: string | undefined }[] = [];

const NOTHING_CLAIMED = { acknowledged: 1, beanspruchung: null, beansprucht_bis: null, aenderungen: [], empfaenger: [], uebersprungen: 0 };

const client = doubleApiAnswers(({ endpoint, method }) => {
  traces.push({ endpoint, trace: getRequestTraceId() });
  if (endpoint === "/berechtigungen/abgleich") return Promise.resolve(NOTHING_CLAIMED);
  return Promise.resolve(method === "DELETE" ? { acknowledged: 1, berechtigung_id: GRANT_ID } : { acknowledged: 1, created_id: GRANT_ID });
});

const { deleteBerechtigungAction, postBerechtigungAction } = await import("./actions.ts");
const { getRequestTraceId } = await import("@/core/requestScope.ts");

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

  /* A change of privilege rotates the session: one the address made before the grant, by a passkey it
     enrolled while holding none, would otherwise administer at once (`docs/frontend/spec.md :: I470`). */
  it("ends every session of the address granted, and none for a refused grant", async () => {
    await postBerechtigungAction({ email: "Neu@Schule.de" });
    assert.deepEqual(signedOut(), ["Neu@Schule.de"]);

    client.answerWith(() => Promise.reject(new Error("refused")));
    await postBerechtigungAction({ email: "zwei@schule.de" }).catch(() => undefined);
    assert.deepEqual(signedOut(), ["Neu@Schule.de"], "a grant that failed signed its address out");
  });

  it("keeps a grant whose sessions could not be ended, and says so", async () => {
    failSignOut(new Error("store down"));

    const result = await postBerechtigungAction({ email: "neu@schule.de" });

    assert.equal(result.success, true);
    assert.equal("message" in result && result.message, "Laufende Anmeldungen der Adresse konnten nicht beendet werden.");
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
  ] as const) {
    it(`runs the claim behind the ${name}'s answer, outside the action's request`, async () => {
      assert.equal((await act()).success, true);
      const [write] = traces;
      assert.ok(write?.trace !== undefined, "the action ran in no request, so the case below proves nothing");

      await Promise.all(deferred.map((task) => task()));

      assert.deepEqual(traces.slice(1), [{ endpoint: "/berechtigungen/abgleich", trace: undefined }]);
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

describe("the window both are held to", () => {
  /* Five minutes, not the step-up's two hours (`docs/frontend/spec.md :: I458`). The standing window
     still holds here, which is what makes the case about the narrow one. */
  it("refuses both from a session confirmed six minutes ago, sending nothing", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    setSession({ user: { email: "vorstand@example.org" } });
    // The doubled store stamps the session as it first serves it, which is now.
    assert.equal((await postBerechtigungAction({ email: "neu@schule.de" })).success, true);
    client.calls.length = 0;

    t.mock.timers.tick(6 * MINUTE_MS);
    const erteilt = await postBerechtigungAction({ email: "neu@schule.de" });
    const entzogen = await deleteBerechtigungAction({ id: GRANT_ID });

    for (const refused of [erteilt, entzogen]) {
      assert.equal(refused.success, false);
      assert.equal("stepUp" in refused && refused.stepUp, true, "the refusal does not ask the page to confirm");
    }
    assert.deepEqual(client.calls, [], "a stale session reached the backend");
  });

  it("sends both from a session confirmed four minutes ago", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: 2_000_000 });
    setSession({ user: { email: "vorstand@example.org" } });
    assert.equal((await postBerechtigungAction({ email: "neu@schule.de" })).success, true);

    t.mock.timers.tick(4 * MINUTE_MS);

    assert.equal((await deleteBerechtigungAction({ id: GRANT_ID })).success, true);
  });
});
