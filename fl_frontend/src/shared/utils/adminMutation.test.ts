import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

/** What the guard resolves, set per case; and every refresh the spine asked Next for. */
const SESSION = "__flSpineSession";
const REFRESHED = "__flSpineRefreshed";
const bus = globalThis as unknown as Record<string, unknown>;
const ADMIN = { user: { email: "vorstand@example.org" } };

/* Replaced at the module boundary, as `fl_frontend/src/shared/utils/publicRoute.test.ts` replaces them:
   the trace seed, the refresh, the session and the framework's control-flow rethrow are the
   framework's, and the spine between them and the action is what is driven. */
const PACKAGE_DOUBLES: Record<string, string> = {
  "next/headers": `export const headers = async () => new Headers();`,
  "next/navigation": `export const unstable_rethrow = () => {};`,
  "next/cache": `export const refresh = () => { globalThis.${REFRESHED}.push(1); };`,
};
const LOGGING = `export const logger = { info: () => {}, warn: () => {}, error: () => {} };`;
// A session set to an `Error` is a session store that threw.
const AUTH = `export const getAdminSession = async () => {
  const session = globalThis.${SESSION};
  if (session instanceof Error) throw session;
  return session;
};`;

const asModule = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const double = PACKAGE_DOUBLES[specifier];
    return double === undefined ? nextResolve(specifier, context) : { url: asModule(double), shortCircuit: true };
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/logging.ts")) return { format: "module", source: LOGGING, shortCircuit: true };
    if (url.endsWith("/src/core/auth.ts")) return { format: "module", source: AUTH, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const refreshed: number[] = [];
bus[REFRESHED] = refreshed;

// An administrator signed in unless a case says otherwise, and no refresh carried into the next case.
beforeEach(() => {
  bus[SESSION] = ADMIN;
  refreshed.length = 0;
});

const { ADMIN_FORBIDDEN, runAdminMutation, runAdminRouteWrite } = await import("./adminMutation.ts");
const { boundCall, recordWriteSent, REQUEST_DEADLINE_MS } = await import("@/core/requestScope");
const { APIBadStatusError, APINetworkError, RolledBackError } = await import("@/core/errors");

/** A body that sends a write before it answers, as a call through the API client records one. */
const writing =
  <T>(answer: () => Promise<T>) =>
  (): Promise<T> => {
    recordWriteSent();
    return answer();
  };

describe("the session guard every admin write runs behind", () => {
  /* Ahead of the body, so an unauthenticated caller reaches neither the payload nor the backend: the
     proxy's matcher is the only other layer (`docs/frontend/spec.md :: I7`). */
  it("turns away a caller with no admin session before the body runs", async () => {
    bus[SESSION] = null;
    let ran = 0;

    const answer = await runAdminMutation("probeAction", () => {
      ran += 1;
      return Promise.resolve({ success: true });
    });

    assert.deepEqual(answer, { success: false, error: ADMIN_FORBIDDEN });
    assert.equal(ran, 0, "the body ran for a caller nobody authorized");
    assert.deepEqual(refreshed, [], "a refused caller's page was refreshed");
  });

  it("turns one away from a route handler's write too", async () => {
    bus[SESSION] = null;
    let ran = 0;

    const answer = await runAdminRouteWrite("probeRoute", () => {
      ran += 1;
      return Promise.resolve({ success: true });
    });

    // Typed rather than worded, so the route chooses its 401 or 403 on the guard's refusal and no other.
    assert.deepEqual(answer, { forbidden: true });
    assert.equal(ran, 0, "the route's body ran for a caller nobody authorized");
  });

  /* The body never ran, so nothing was written: an unclear answer would send the admin to check for a
     change that cannot exist. */
  it("answers a session store that threw as the failure it is, the body never having run", async () => {
    bus[SESSION] = new Error("the session store is down");
    let ran = 0;

    const answer = await runAdminMutation("probeAction", () => {
      ran += 1;
      return Promise.resolve({ success: true });
    });

    assert.deepEqual(answer, { success: false, error: "Lade die Seite neu und versuche es erneut." });
    assert.equal(ran, 0, "the body ran behind a guard that never resolved");
  });

  /* The session the guard resolved, so an action needing it pays no second read of the session store. */
  it("hands the body the session it resolved", async () => {
    let seen: unknown;

    await runAdminMutation("probeAction", (session) => {
      seen = session;
      return Promise.resolve({ success: true });
    });

    assert.equal(seen, ADMIN);
  });
});

describe("the refresh an admin write owes the page", () => {
  it("refreshes once after a write succeeds", async () => {
    await runAdminMutation(
      "probeAction",
      writing(() => Promise.resolve({ success: true })),
    );

    assert.equal(refreshed.length, 1, "a write that succeeded left the admin's page standing");
  });

  /* A body sending no write moved nothing, and a refusal is answered on a page the admin may still
     need: a refresh re-renders it under the toast. */
  it("refreshes nothing after a body that sent no write, or a refused write", async () => {
    await runAdminMutation("probeAction", () => Promise.resolve({ success: true }));
    await runAdminMutation("probeAction", () => Promise.reject(new RangeError("Invalid time value")));
    await runAdminMutation(
      "probeAction",
      writing(() => Promise.resolve({ success: false, error: "Nein." })),
    );

    assert.deepEqual(refreshed, []);
  });

  /* The row may stand behind the throw, and a page left as it was offers the write again. */
  it("refreshes once after a write of unknown outcome, thrown or answered", async () => {
    for (const body of [
      writing(() => Promise.reject(new RangeError("Invalid time value"))),
      writing(() => Promise.resolve({ success: false, error: "Unklar.", outcome: "unknown" as const })),
    ]) {
      refreshed.length = 0;
      await runAdminMutation("probeAction", body);

      assert.equal(refreshed.length, 1, "a write that may have landed left the admin's page standing");
    }
  });

  /* Next throws on `refresh()` outside a server action, which the spine would answer as an unclear undo. */
  it("leaves a route handler's success to the route", async () => {
    const answer = await runAdminRouteWrite(
      "probeRoute",
      writing(() => Promise.resolve({ success: true })),
    );

    assert.deepEqual(answer, { forbidden: false, answer: { success: true } });
    assert.deepEqual(refreshed, []);
  });
});

/** What an action answers when its own code throws, after a write it sent or with none sent. */
const thrownIn = (wrote: boolean) =>
  runAdminMutation("probeAction", async (): Promise<{ success: true }> => {
    if (wrote) recordWriteSent();
    throw new RangeError("Invalid time value");
  });

describe("a throw of an admin action's own code", () => {
  /* A write's code after its API call can throw with the row already stored: answered as a failure,
     the admin repeats a write that may stand. */
  it("answers a throw after a sent write as of unknown outcome", async () => {
    const answer = await thrownIn(true);

    assert.equal(answer.success, false);
    assert.equal("outcome" in answer ? answer.outcome : undefined, "unknown");
  });

  it("answers a throw before any write, which changed nothing, as the failure it is", async () => {
    const answer = await thrownIn(false);

    assert.equal("outcome" in answer ? answer.outcome : undefined, undefined);
    assert.equal("error" in answer ? answer.error : undefined, "Lade die Seite neu und versuche es erneut.");
  });
});

describe("a throw of an API call inside an admin action", () => {
  const SENT = { url: "http://api/x", endpoint: "/x", traceId: "a".repeat(32) };
  const timedOut = (method: string) => new APINetworkError({ ...SENT, message: "cut", method: method, readOnly: false, isTimeout: true });

  /* The read's own error says only that the read changed nothing, while the write before it may stand. */
  it("answers a read's failure after a sent write as of unknown outcome, and refreshes", async () => {
    const answer = await runAdminMutation(
      "probeAction",
      writing(() => Promise.reject(timedOut("GET"))),
    );

    assert.equal("outcome" in answer ? answer.outcome : undefined, "unknown");
    assert.equal(refreshed.length, 1, "a write that may have landed left the admin's page standing");
  });

  /* The write's own answer is the one thing that says whether it landed. */
  it("answers the sent write's own refusal, or its transaction's rollback, as the failure it is", async () => {
    const refused = new APIBadStatusError({ ...SENT, message: "refused", statusCode: 404, method: "PATCH", readOnly: false });

    for (const thrown of [refused, new RolledBackError(new Error("write conflict"))]) {
      const answer = await runAdminMutation(
        "probeAction",
        writing(() => Promise.reject(thrown)),
      );

      assert.equal("outcome" in answer ? answer.outcome : undefined, undefined, `${thrown.name} answered as unclear`);
    }
    assert.deepEqual(refreshed, [], "a write that landed nothing refreshed the page");
  });
});

describe("an admin action the request's deadline cut", () => {
  /** `performance.now()`'s reading, which the deadline is measured on. */
  let clock = 0;

  beforeEach(() => {
    clock = 0;
    mock.method(performance, "now", () => clock);
  });

  afterEach(() => {
    mock.restoreAll();
  });

  /** An action that asks for one bounded call once the deadline has passed, and then answers `settled` as a fan-out settles a refused send. */
  const cutIn = (wrote: boolean, settled: { success: boolean; message?: string }) =>
    runAdminMutation("probeAction", () => {
      if (wrote) recordWriteSent();
      clock += REQUEST_DEADLINE_MS;
      boundCall(1000);

      return Promise.resolve(settled);
    });

  /* The shape the mail actions take: every send settled, the refused one among them, and a clean
     sentence built from what settled while a message may already be in somebody's inbox. */
  it("answers a write as of unknown outcome, whatever the action answered itself", async () => {
    for (const settled of [
      { success: true, message: "Gesendet." },
      { success: false, message: "Die E-Mail konnte nicht gesendet werden." },
    ]) {
      refreshed.length = 0;
      const answer = await cutIn(true, settled);

      assert.equal("outcome" in answer ? answer.outcome : undefined, "unknown", `a cut write answered ${JSON.stringify(answer)}`);
      assert.equal(refreshed.length, 1, `a cut write answering ${JSON.stringify(settled)} left the admin's page standing`);
    }
  });

  it("answers a body that sent no write with what it answered itself, a read changing nothing", async () => {
    const settled = { success: false, message: "Der Server hat zu lange nicht geantwortet." };

    assert.deepEqual(await cutIn(false, settled), settled);
  });

  it("answers a write the deadline never cut with what it answered itself", async () => {
    const settled = { success: true, message: "Gespeichert." };
    const answer = await runAdminMutation("probeAction", () => {
      recordWriteSent();
      boundCall(1000).clear();

      return Promise.resolve(settled);
    });

    assert.deepEqual(answer, settled);
  });
});
