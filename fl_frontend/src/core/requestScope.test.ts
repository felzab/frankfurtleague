import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import {
  boundCall,
  getRequestActor,
  getRequestSpanId,
  getRequestTraceId,
  recordWriteSent,
  REQUEST_DEADLINE_MS,
  requestOutcomeUnknown,
  requestWriteSent,
  runAnsweringOwnCut,
  runWithRequestScope,
  setRequestActor,
} from "./requestScope.ts";

// The two outbound clients' configuration and log, replaced at the module boundary: the real config
// reads credentials no test run holds, and the mail client posts only for a production deployment.
const MODULE_DOUBLES: Readonly<Record<string, string>> = {
  "/src/core/config.ts": `export const frontend_config = {
  API_URL: "http://backend:8000",
  API_VERSION: 0,
  INTERNAL_API_KEY_BASE: "base-key-double",
  INTERNAL_API_KEY_SYSTEM: "system-key-double",
  INTERNAL_API_KEY_ADMIN: "admin-key-double",
  APP_ENV: "production",
  AUTH_RESEND_KEY: "resend-key-double",
};`,
  "/src/core/logging.ts": "const inert = () => undefined; export const logger = { debug: inert, info: inert, warn: inert, error: inert };",
};

registerHooks({
  resolve: (specifier, context, nextResolve) =>
    specifier === "server-only" ? { url: "data:text/javascript,export%20%7B%7D%3B", shortCircuit: true } : nextResolve(specifier, context),
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    const double = Object.entries(MODULE_DOUBLES).find(([tail]) => url.endsWith(tail))?.[1];
    return double === undefined ? nextLoad(url, context) : { format: "module", source: double, shortCircuit: true };
  },
});

const { apiClient } = await import("./api.ts");
const { sendMail } = await import("./mail.ts");

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

  /* A slice's read opens a scope inside the action awaiting it: a scope of its own there would send
     that read's admin call, and any write made inside it, with no actor. */
  it("keeps the recorded actor in a scope opened inside the one the guard ran in", async () => {
    const actor = await runWithRequestScope(scope(), async () => {
      setRequestActor(ADMIN);

      return runWithRequestScope({ traceId: `${"0".repeat(31)}2`, spanId: `${"0".repeat(15)}2` }, () => Promise.resolve(getRequestActor()));
    });

    assert.equal(actor, ADMIN, "the nested scope dropped the actor");
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

      return Promise.resolve([early, signal.aborted, requestOutcomeUnknown()]);
    });

    assert.equal(abortedEarly, false, "the call was aborted before the deadline");
    assert.equal(abortedAtDeadline, true, "the deadline passed and the call ran on to its own bound");
    assert.equal(cut, true, "the deadline aborted a call and the request does not know it");
  });

  it("refuses a call once nothing is left, with no timer to wait on", async () => {
    const [aborted, cut] = await runWithRequestScope(scope(), () => {
      advance(REQUEST_DEADLINE_MS);
      const { signal } = boundCall(OWN_BOUND_MS);

      return Promise.resolve([signal.aborted, requestOutcomeUnknown()]);
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

      return [aborted, requestOutcomeUnknown()];
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

      return Promise.resolve([signal.aborted, requestOutcomeUnknown()]);
    });

    assert.equal(aborted, true);
    assert.equal(cut, false, "a call's own timeout was taken for the request's deadline");
  });

  /* A ban's notice is sent after its ban's write was acknowledged, and the create's answer says the notice is
     unclear: marked on the request, the spine would call the ban unclear too. */
  it("keeps a cut its caller answers off the request, and still counts the write it sent", async () => {
    const [aborted, cut, wrote] = await runWithRequestScope(scope(), async () => {
      advance(REQUEST_DEADLINE_MS - 5000);
      const aborted = await runAnsweringOwnCut(() => {
        const { signal } = boundCall(OWN_BOUND_MS);
        recordWriteSent();
        advance(5000);

        return Promise.resolve(signal.aborted);
      });

      return [aborted, requestOutcomeUnknown(), requestWriteSent()];
    });

    assert.equal(aborted, true, "the deadline never cut the answered call, so nothing below is judged");
    assert.equal(cut, false, "a cut the caller answers itself marked the whole request");
    assert.equal(wrote, true, "a write sent inside the answered call went uncounted");
  });

  it("leaves standing a cut of a call running beside one its caller answers", async () => {
    const cut = await runWithRequestScope(scope(), async () => {
      advance(REQUEST_DEADLINE_MS - 5000);
      let release = (): void => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      // Still running when the deadline passes, as a send in flight is.
      const answered = runAnsweringOwnCut(async () => {
        boundCall(OWN_BOUND_MS);
        await held;
      });
      boundCall(OWN_BOUND_MS);
      advance(5000);
      release();
      await answered;

      return requestOutcomeUnknown();
    });

    assert.equal(cut, true, "the answered call's end cleared a cut it never made");
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
  let clock = 0;
  const advance = (ms: number) => {
    clock += ms;
    mock.timers.tick(ms);
  };

  /** Every signal a call handed the transport, which never answers until that signal aborts. */
  const signals: AbortSignal[] = [];

  beforeEach(() => {
    clock = 0;
    signals.length = 0;
    mock.method(performance, "now", () => clock);
    mock.timers.enable({ apis: ["setTimeout"] });
    mock.method(globalThis, "fetch", (_input: unknown, init?: RequestInit) => {
      const signal = init?.signal ?? assert.fail("a call reached the transport with no signal");
      signals.push(signal);
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason as Error)));
    });
  });

  afterEach(() => {
    mock.timers.reset();
    mock.restoreAll();
  });

  // Called at the start of a request, a call that never answers is ended before the deadline, and by its
  // own bound: the deadline's cut would mark the request's outcome unknown.
  for (const [client, call] of [
    ["the backend client", () => apiClient("/x", { parse: (value: unknown) => value } as never)],
    ["the mail client", () => sendMail({ to: "anna@example.org", subject: "Betreff", html: "<p>x</p>", text: "x" })],
  ] as const) {
    it(`ends ${client}'s call by its own bound, inside the deadline`, async () => {
      const [aborted, cut] = await runWithRequestScope(scope(), async () => {
        const settled = call().catch(() => undefined);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(signals.length, 1, `${client} reached the transport ${String(signals.length)} times`);

        advance(REQUEST_DEADLINE_MS - 1);
        const answer = [signals[0]?.aborted, requestOutcomeUnknown()];
        advance(REQUEST_DEADLINE_MS);
        await settled;

        return answer;
      });

      assert.equal(aborted, true, `${client}'s call ran on to the deadline: its own bound is not under it`);
      assert.equal(cut, false, "the deadline, not the call's own bound, ended it");
    });
  }

  it("keeps the deadline under the edge's cut", () => {
    const siteConf = readFileSync(path.resolve(import.meta.dirname, "..", "..", "..", "nginx", "shared", "site.conf"), "utf8");
    const found = /^proxy_read_timeout (\d+)s;$/m.exec(siteConf);
    assert.ok(found, "nginx/shared/site.conf no longer declares the edge's read timeout");

    assert.ok(REQUEST_DEADLINE_MS < Number(found[1]) * 1000, "the request's deadline is not under the edge's cut");
  });
});
