import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { cacheCalls, doubleActionRequest } from "@/shared/testing/actionDoubles.ts";

/* The trace seed, the refresh, the session and the framework's control-flow rethrow are the
   framework's, and the spine between them and the action is what is driven. */
const ADMIN = { user: { email: "vorstand@example.org" } };
const { setSession, setRefusal } = doubleActionRequest({ session: ADMIN });

/** How many times the spine asked Next to refresh the page since the case began. */
const refreshes = (): number => cacheCalls.filter(({ name }) => name === "refresh").length;

const { ADMIN_FORBIDDEN, invalidatesOnWrite, runAdminMutation, runAdminRouteWrite, stepUpRequired } = await import("./adminMutation.ts");
const { boundCall, recordWriteSent, REQUEST_DEADLINE_MS } = await import("@/core/requestScope");
const { getAdminSession } = await import("@/core/auth");
const { APIBadStatusError, APINetworkError, ApiUnsentError, RolledBackError } = await import("@/core/errors");
const { refusedOn } = await import("@/shared/testing/publishedRefusals.ts");
const { ENROLMENT_WINDOW_MS } = await import("@/core/sessionLifetimes");

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
    setSession(null);
    let ran = 0;

    const answer = await runAdminMutation("probeAction", () => {
      ran += 1;
      return Promise.resolve({ success: true });
    });

    assert.deepEqual(answer, { success: false, error: ADMIN_FORBIDDEN });
    assert.equal(ran, 0, "the body ran for a caller nobody authorized");
    assert.equal(refreshes(), 0, "a refused caller's page was refreshed");
  });

  /* A session the guard would pass but for its grant: „Melde Dich neu an“ would send the administrator to a
     sign-in that restores nothing. */
  it("tells a caller whose grant is gone so, rather than to sign in again", async () => {
    setSession(null);
    setRefusal("grantGone");

    const answer = await runAdminMutation("probeAction", () => Promise.resolve({ success: true }));

    assert.deepEqual(answer, { success: false, error: "Dein Zugang zur Verwaltung besteht nicht mehr." });
  });

  /* The backend did not answer the grant lookup: a sign-in would meet the same unread grant, and the
     session holds whatever administration it held, so the remedy is the retry and never the sign-in. */
  it("tells a caller whose grant the backend left unread to try again, rather than to sign in", async () => {
    setSession(null);
    setRefusal("unread");
    let ran = 0;

    const answer = await runAdminMutation("probeAction", () => {
      ran += 1;
      return Promise.resolve({ success: true });
    });

    assert.deepEqual(answer, { success: false, error: "Dein Zugang zur Verwaltung ließ sich gerade nicht prüfen. Versuche es erneut." });
    assert.equal(ran, 0, "the body ran behind a grant nobody read");
  });

  /* A signed-in address holding no grant: no sign-in grants one, so it is told what a revoked grant is
     told, and never „Melde Dich neu an“. */
  it("tells a caller whose address holds no grant that its access is gone, rather than to sign in again", async () => {
    setSession(null);
    setRefusal("noGrant");

    assert.deepEqual(await runAdminMutation("probeAction", () => Promise.resolve({ success: true })), {
      success: false,
      error: "Dein Zugang zur Verwaltung besteht nicht mehr.",
    });
  });

  it("turns one away from a route handler's write too", async () => {
    setSession(null);
    let ran = 0;

    const answer = await runAdminRouteWrite("probeRoute", () => {
      ran += 1;
      return Promise.resolve({ success: true });
    });

    // Typed rather than worded, so the route chooses its 401 or 403 on the guard's refusal and no other.
    assert.deepEqual(answer, { forbidden: true, refused: "signIn" });
    assert.equal(ran, 0, "the route's body ran for a caller nobody authorized");

    // The reason is the guard's own, read off the call that refused rather than a second read.
    setSession(null, "/bereich");
    assert.deepEqual(await runAdminRouteWrite("probeRoute", () => Promise.resolve({ success: true })), { forbidden: true, refused: "noGrant" });
  });

  /* The body never ran, so nothing was written: an unclear answer would send the admin to check for a
     change that cannot exist. */
  it("answers a session store that threw as the failure it is, the body never having run", async () => {
    setSession(new Error("the session store is down"));
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

    assert.equal(seen, await getAdminSession(), "the body was handed a session other than the one the guard resolved");
  });
});

describe("the enrolment window a grant's write is held to", () => {
  afterEach(() => mock.timers.reset());

  /* Inside the step-up window and past the enrolment one: a write declaring either window is held to
     its own, and the narrow one refuses what the wide one lets through. */
  it("refuses a session confirmed six minutes ago, where the step-up window alone admits it", async () => {
    mock.timers.enable({ apis: ["Date"], now: Date.now() });
    mock.timers.tick(ENROLMENT_WINDOW_MS + 60_000);
    let ran = 0;
    const body = () => {
      ran += 1;
      return Promise.resolve({ success: true });
    };

    assert.equal(Reflect.get(await runAdminMutation("probeAction", { stepUp: "enrolment" }, body), "stepUp"), true);
    assert.equal(ran, 0, "a session past the enrolment window reached the body");
    assert.deepEqual(await runAdminMutation("probeAction", { stepUp: true }, body), { success: true });
  });
});

describe("the refresh an admin write owes the page", () => {
  it("refreshes once after a write succeeds", async () => {
    await runAdminMutation(
      "probeAction",
      writing(() => Promise.resolve({ success: true })),
    );

    assert.equal(refreshes(), 1, "a write that succeeded left the admin's page standing");
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

    assert.equal(refreshes(), 0);
  });

  /* The row may stand behind the throw, and a page left as it was offers the write again. */
  it("refreshes once after a write of unknown outcome, thrown or answered", async () => {
    for (const body of [
      writing(() => Promise.reject(new RangeError("Invalid time value"))),
      writing(() => Promise.resolve({ success: false, error: "Unklar.", outcome: "unknown" as const })),
    ]) {
      cacheCalls.length = 0;
      await runAdminMutation("probeAction", body);

      assert.equal(refreshes(), 1, "a write that may have landed left the admin's page standing");
    }
  });

  /* A drop after the awaited write never reaches a write whose answer was lost, and the cached public
     read it feeds serves the replaced data for days (`docs/frontend/spec.md :: I894`). */
  it("drops the tags a body declared after a landed write, and after one whose answer was lost", async () => {
    const lost = new APINetworkError({
      message: "Request failed.",
      url: "http://backend:8000",
      method: "PATCH",
      readOnly: false,
      traceId: "0",
      isTimeout: false,
    });
    for (const answer of [() => Promise.resolve({ success: true }), () => Promise.reject(lost)]) {
      cacheCalls.length = 0;
      await runAdminMutation(
        "probeAction",
        writing(() => {
          invalidatesOnWrite("spieler", "teams:saison_id:2526");
          return answer();
        }),
      );

      assert.deepEqual(
        cacheCalls.map(({ name, args }) => [name, ...args]),
        [["updateTag", "spieler"], ["updateTag", "teams:saison_id:2526"], ["refresh"]],
      );
    }
  });

  /* A partial answer stands behind a landed write the page is not re-read for; a refusal and a body
     that sent nothing moved no cached read. */
  it("drops them after a partial write without the refresh, and never after a refusal or no write", async () => {
    const declaring =
      <T>(answer: T) =>
      (): Promise<T> => {
        invalidatesOnWrite("teams");
        return Promise.resolve(answer);
      };

    await runAdminMutation("probeAction", writing(declaring({ success: false, error: "Teils.", outcome: "partial" as const })));
    assert.deepEqual(
      cacheCalls.map(({ name, args }) => [name, ...args]),
      [["updateTag", "teams"]],
    );

    cacheCalls.length = 0;
    await runAdminMutation("probeAction", writing(declaring({ success: false, error: "Nein." })));
    await runAdminMutation("probeAction", declaring({ success: true }));
    assert.deepEqual(cacheCalls, []);
  });

  /* Next throws on `refresh()` outside a server action, which the spine would answer as an unclear undo. */
  it("leaves a route handler's success to the route", async () => {
    const answer = await runAdminRouteWrite(
      "probeRoute",
      writing(() => Promise.resolve({ success: true })),
    );

    assert.deepEqual(answer, { forbidden: false, answer: { success: true } });
    assert.equal(refreshes(), 0);
  });

  /* An undo replaying a step-up write meets the backend's own window as an action does: answered in other
     words, the admin is sent to a retry the same window refuses (`docs/frontend/spec.md :: I493`). */
  it("answers the backend's refusal for want of a confirmation as the step-up refusal, refreshing nothing", async () => {
    // The contacts save, one of the step-up writes an undo replays.
    const refused = refusedOn("PATCH /teams/{team_id}/saisons/{saison_id}/kontakte", "REQ-AUTH-009");

    const answer = await runAdminRouteWrite(
      "probeRoute",
      writing(() => Promise.reject(refused)),
    );

    assert.deepEqual(answer, { forbidden: false, answer: stepUpRequired() });
    assert.equal(refreshes(), 0, "a route handler's write called the refresh Next refuses it");
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
    assert.equal(refreshes(), 1, "a write that may have landed left the admin's page standing");
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
    assert.equal(refreshes(), 0, "a write that landed nothing refreshed the page");
  });

  /* Nothing left the request, so an unclear answer would send the admin to check for a change that cannot exist. */
  it("answers a first write the deadline refused unsent as the failure it is, refreshing nothing", async () => {
    const answer = await runAdminMutation("probeAction", () => Promise.reject(new ApiUnsentError("POST")));

    assert.equal("outcome" in answer ? answer.outcome : undefined, undefined);
    assert.equal("error" in answer ? answer.error : undefined, "Lade die Seite neu und versuche es erneut.");
    assert.equal(refreshes(), 0);
  });

  it("answers an unsent write behind a sent one as of unknown outcome, and refreshes", async () => {
    const answer = await runAdminMutation(
      "probeAction",
      writing(() => Promise.reject(new ApiUnsentError("PATCH"))),
    );

    assert.equal("outcome" in answer ? answer.outcome : undefined, "unknown");
    assert.equal(refreshes(), 1, "a write that may have landed left the admin's page standing");
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
      cacheCalls.length = 0;
      const answer = await cutIn(true, settled);

      assert.equal("outcome" in answer ? answer.outcome : undefined, "unknown", `a cut write answered ${JSON.stringify(answer)}`);
      assert.equal(refreshes(), 1, `a cut write answering ${JSON.stringify(settled)} left the admin's page standing`);
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
