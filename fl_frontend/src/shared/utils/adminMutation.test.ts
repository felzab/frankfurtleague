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
const { boundCall, REQUEST_DEADLINE_MS } = await import("@/core/requestScope");

describe("the session guard every admin write runs behind", () => {
  /* Ahead of the body, so an unauthenticated caller reaches neither the payload nor the backend: the
     proxy's matcher is the only other layer (`docs/frontend/spec.md :: I7`). */
  it("turns away a caller with no admin session before the body runs, a write and a read alike", async () => {
    bus[SESSION] = null;
    let ran = 0;

    for (const readOnly of [false, true]) {
      const answer = await runAdminMutation("probeAction", { readOnly: readOnly }, () => {
        ran += 1;
        return Promise.resolve({ success: true });
      });

      assert.deepEqual(answer, { success: false, error: ADMIN_FORBIDDEN }, `readOnly: ${String(readOnly)}`);
    }
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

    const answer = await runAdminMutation("probeAction", { readOnly: false }, () => {
      ran += 1;
      return Promise.resolve({ success: true });
    });

    assert.deepEqual(answer, { success: false, error: "Lade die Seite neu und versuche es erneut." });
    assert.equal(ran, 0, "the body ran behind a guard that never resolved");
  });

  /* The session the guard resolved, so an action needing it pays no second read of the session store. */
  it("hands the body the session it resolved", async () => {
    let seen: unknown;

    await runAdminMutation("probeAction", { readOnly: false }, (session) => {
      seen = session;
      return Promise.resolve({ success: true });
    });

    assert.equal(seen, ADMIN);
  });
});

describe("the refresh an admin write owes the page", () => {
  it("refreshes once after a write succeeds", async () => {
    await runAdminMutation("probeAction", { readOnly: false }, () => Promise.resolve({ success: true }));

    assert.equal(refreshed.length, 1, "a write that succeeded left the admin's page standing");
  });

  /* A read moved nothing, and a failure or a throw is answered on a page the admin may still need:
     a refresh re-renders it under the toast. */
  it("refreshes nothing after a read, a refused write or a throw", async () => {
    await runAdminMutation("probeAction", { readOnly: true }, () => Promise.resolve({ success: true }));
    await runAdminMutation("probeAction", { readOnly: false }, () => Promise.resolve({ success: false, error: "Nein." }));
    await runAdminMutation("probeAction", { readOnly: false }, () => Promise.reject(new RangeError("Invalid time value")));

    assert.deepEqual(refreshed, []);
  });

  /* Next throws on `refresh()` outside a server action, which the spine would answer as an unclear undo. */
  it("leaves a route handler's success to the route", async () => {
    const answer = await runAdminRouteWrite("probeRoute", () => Promise.resolve({ success: true }));

    assert.deepEqual(answer, { forbidden: false, answer: { success: true } });
    assert.deepEqual(refreshed, []);
  });
});

/** What an action answers when its own code throws, declared a read or a write at its call site. */
const thrownIn = (readOnly: boolean) =>
  runAdminMutation("probeAction", { readOnly: readOnly }, async (): Promise<{ success: true }> => {
    throw new RangeError("Invalid time value");
  });

describe("a throw of an admin action's own code", () => {
  /* A write's code after its API call can throw with the row already stored: answered as a failure,
     the admin repeats a write that may stand. */
  it("answers a write as of unknown outcome", async () => {
    const answer = await thrownIn(false);

    assert.equal(answer.success, false);
    assert.equal("outcome" in answer ? answer.outcome : undefined, "unknown");
  });

  it("answers a read, which changed nothing, as the failure it is", async () => {
    const answer = await thrownIn(true);

    assert.equal("outcome" in answer ? answer.outcome : undefined, undefined);
    assert.equal("error" in answer ? answer.error : undefined, "Lade die Seite neu und versuche es erneut.");
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
  const cutIn = (readOnly: boolean, settled: { success: boolean; message?: string }) =>
    runAdminMutation("probeAction", { readOnly: readOnly }, () => {
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
      const answer = await cutIn(false, settled);

      assert.equal("outcome" in answer ? answer.outcome : undefined, "unknown", `a cut write answered ${JSON.stringify(answer)}`);
    }
  });

  it("answers a read with what it answered itself, a read changing nothing", async () => {
    const settled = { success: false, message: "Der Server hat zu lange nicht geantwortet." };

    assert.deepEqual(await cutIn(true, settled), settled);
  });

  it("answers a write the deadline never cut with what it answered itself", async () => {
    const settled = { success: true, message: "Gespeichert." };
    const answer = await runAdminMutation("probeAction", { readOnly: false }, () => {
      boundCall(1000).clear();

      return Promise.resolve(settled);
    });

    assert.deepEqual(answer, settled);
  });
});
