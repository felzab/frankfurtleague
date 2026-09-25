import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import {
  boundCall,
  getRequestActor,
  getRequestSpanId,
  getRequestTraceId,
  REQUEST_DEADLINE_MS,
  requestDeadlineCut,
  runWithRequestScope,
  setRequestActor,
} from "./requestScope.ts";

const TRACE_ID = `${"0".repeat(31)}1`;
const SPAN_ID = `${"0".repeat(15)}1`;

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

describe("the one deadline a request runs under", () => {
  /** `performance.now()`'s reading, which the mocked timers leave alone and `advance` moves beside them. */
  let clock = 0;
  const advance = (ms: number) => {
    clock += ms;
    mock.timers.tick(ms);
  };

  const OWN_BOUND_MS = 15000;

  beforeEach(() => {
    clock = 0;
    mock.method(performance, "now", () => clock);
    mock.timers.enable({ apis: ["setTimeout"] });
  });

  afterEach(() => {
    mock.timers.reset();
    mock.restoreAll();
  });

  it("aborts a call begun late at what is left of the deadline, not at its own bound, and marks the cut", async () => {
    const [abortedEarly, abortedAtDeadline, cut] = await runWithRequestScope(scope(), () => {
      advance(REQUEST_DEADLINE_MS - 5000);
      const { signal } = boundCall(OWN_BOUND_MS);

      advance(4999);
      const early = signal.aborted;
      advance(1);

      return Promise.resolve([early, signal.aborted, requestDeadlineCut()]);
    });

    assert.equal(abortedEarly, false, "the call was aborted before the deadline");
    assert.equal(abortedAtDeadline, true, "the deadline passed and the call ran on to its own bound");
    assert.equal(cut, true, "the deadline aborted a call and the request does not know it");
  });

  it("refuses a call once nothing is left, with no timer to wait on", async () => {
    const [aborted, cut] = await runWithRequestScope(scope(), () => {
      advance(REQUEST_DEADLINE_MS);
      const { signal } = boundCall(OWN_BOUND_MS);

      return Promise.resolve([signal.aborted, requestDeadlineCut()]);
    });

    assert.equal(aborted, true, "a call was given a live signal after the deadline had passed");
    assert.equal(cut, true);
  });

  /* A slice's read opens a scope of its own inside the action awaiting it: a fresh deadline there would
     hand every read of a chain the whole budget again. */
  it("keeps the deadline of the scope a nested one opens inside, and shares its cut", async () => {
    const [aborted, cutOutside] = await runWithRequestScope(scope(), async () => {
      advance(REQUEST_DEADLINE_MS - 5000);
      const aborted = await runWithRequestScope(scope(), () => {
        const { signal } = boundCall(OWN_BOUND_MS);
        advance(5000);

        return Promise.resolve(signal.aborted);
      });

      return [aborted, requestDeadlineCut()];
    });

    assert.equal(aborted, true, "the nested scope started a deadline of its own");
    assert.equal(cutOutside, true, "a cut inside the nested scope never reached the one around it");
  });

  /* The admin spine reads the mark as "part of this write may stand", so a call its own bound ended —
     whose error already answers it — must not set it. */
  it("leaves the mark unset where the call's own bound ended it", async () => {
    const [aborted, cut] = await runWithRequestScope(scope(), () => {
      const { signal } = boundCall(OWN_BOUND_MS);
      advance(OWN_BOUND_MS);

      return Promise.resolve([signal.aborted, requestDeadlineCut()]);
    });

    assert.equal(aborted, true);
    assert.equal(cut, false, "a call's own timeout was taken for the request's deadline");
  });

  it("stops the timer once the call clears it", async () => {
    const aborted = await runWithRequestScope(scope(), () => {
      const { signal, clear } = boundCall(OWN_BOUND_MS);
      clear();
      advance(REQUEST_DEADLINE_MS);

      return Promise.resolve(signal.aborted);
    });

    assert.equal(aborted, false, "a finished call's timer still fired");
  });

  it("bounds a call outside a scope, a cache fill's, by its own bound alone", () => {
    advance(REQUEST_DEADLINE_MS);
    const { signal } = boundCall(OWN_BOUND_MS);
    const refused = signal.aborted;
    advance(OWN_BOUND_MS);

    assert.equal(refused, false, "a call outside any request met a deadline");
    assert.equal(signal.aborted, true);
  });
});

/* Nested budgets hold in one order only: a call's own bound over the deadline would never bind, and the
   deadline at the edge's cut would be answered by nginx's 504 rather than by this application. */
describe("the budgets a request's calls nest inside", () => {
  const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
  const readConstant = (relative: string, pattern: RegExp): number => {
    const found = pattern.exec(readFileSync(path.join(REPO_ROOT, relative), "utf8"));
    assert.ok(found, `${relative} no longer declares what ${String(pattern)} reads`);

    return Number(found[1]);
  };

  it("keeps every call's own bound under the deadline, and the deadline under the edge's cut", () => {
    const edgeMs = readConstant("nginx/shared/site.conf", /^proxy_read_timeout (\d+)s;$/m) * 1000;

    for (const [file, pattern] of [
      ["fl_frontend/src/core/api.ts", /^const BASE_FETCH_TIMEOUT_MS = (\d+);$/m],
      ["fl_frontend/src/core/mail.ts", /^const MAIL_TIMEOUT_MS = (\d+);$/m],
    ] as const) {
      assert.ok(readConstant(file, pattern) < REQUEST_DEADLINE_MS, `${file}'s own bound is not under the request's deadline`);
    }
    assert.ok(REQUEST_DEADLINE_MS < edgeMs, "the request's deadline is not under the edge's cut");
  });
});
