import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getRequestActor, getRequestSpanId, getRequestTraceId, runWithRequestScope, setRequestActor } from "./requestScope.ts";

const TRACE_ID = `${"0".repeat(31)}1`;
const SPAN_ID = `${"0".repeat(15)}1`;

/** One per run: the scope that is passed IS the store, so a shared object carries an actor between requests. */
const scope = () => ({ traceId: TRACE_ID, spanId: SPAN_ID });

const PERSON = "spielerin@example.org";
const ADMIN = "vorstand@example.org";

describe("the ids a request carries", () => {
  it("answers the ids inside a scope and nothing outside one", () => {
    const inside = runWithRequestScope(scope(), () => Promise.resolve([getRequestTraceId(), getRequestSpanId()]));

    assert.deepEqual(getRequestTraceId(), undefined);
    return inside.then((ids) => {
      assert.deepEqual(ids, [TRACE_ID, SPAN_ID]);
    });
  });
});

describe("the one actor a request is attributed to", () => {
  it("records the actor the guard that resolved the session set", async () => {
    const actor = await runWithRequestScope(scope(), () => {
      setRequestActor(PERSON);

      return Promise.resolve(getRequestActor());
    });

    assert.equal(actor, PERSON);
  });

  /* One guard reached twice on one request is the ordinary shape — a page and its own server action
     both resolve the session — and the spelling both set is one. */
  it("takes the same actor twice", async () => {
    const actor = await runWithRequestScope(scope(), () => {
      setRequestActor(PERSON);
      setRequestActor(PERSON);

      return Promise.resolve(getRequestActor());
    });

    assert.equal(actor, PERSON);
  });

  /* Both session guards on one request: the second spelling would land in `aktionen.actor.email`
     whenever it happened to be set last, attributing the write to whoever did not make it. */
  it("refuses a second, different actor rather than overwriting the one already recorded", async () => {
    const actor = await runWithRequestScope(scope(), () => {
      setRequestActor(PERSON);
      assert.throws(() => {
        setRequestActor(ADMIN);
      });

      return Promise.resolve(getRequestActor());
    });

    assert.equal(actor, PERSON, "the refused actor was written anyway");
  });

  /* The sign-in library's types admit a session carrying no address, and a request that resolved
     none is one nothing may attribute a write to. */
  it("takes a missing actor for a no-op, before and after one is recorded", async () => {
    const answers = await runWithRequestScope(scope(), () => {
      setRequestActor(null);
      const before = getRequestActor();

      setRequestActor(PERSON);
      setRequestActor(undefined);

      return Promise.resolve([before, getRequestActor()]);
    });

    assert.deepEqual(answers, [undefined, PERSON]);
  });

  it("records nothing outside a scope, where a cache fill and a build-time render run", () => {
    setRequestActor(PERSON);

    assert.equal(getRequestActor(), undefined);
  });
});
