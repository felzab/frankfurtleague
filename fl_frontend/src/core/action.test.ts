import { person, seat } from "@/test-support/subjectFixtures.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { action, PAGE_HOLDER } from "./action";
import { afterTheResponse } from "./afterResponse";
import { dispatchRequest, sentRequestOf } from "./apiDispatch";
import { COPY } from "./copy";
import { APIBadStatusError } from "./errors";
import { AFTER_RESPONSE_DEADLINE_MS, getRequestActor, requestTimeLeft, setRequestActor } from "./requestScope";

import type { Code } from "./generated/client/types";
import type { RequestActor } from "./requestScope";
import type { SubjectSession } from "./subject";

/** What each double answers, and what reached it. */
const state = vi.hoisted(() => ({
  admin: { session: {} } as { session: object } | { refused: string },
  subject: null as SubjectSession | null,
  botCheck: null as string | null,
  /** The passkey touch's verdict. */
  touch: true,
  /** The account guard's verdict: the session it judged, or `null` where it refuses. */
  account: null as object | null,
  /** The actor each guard records once it admits, as the real guards do. */
  actor: undefined as RequestActor | undefined,
  /** Every step in the order it ran. */
  steps: [] as string[],
  lines: [] as { level: string; message: string; meta: unknown }[],
  /**
   * Work handed to Next's `after`, run by a case once its action has answered, as Next runs it: bound to the caller's
   * async context, as Next's `after` binds it, so the work starts inside the action's request scope.
   */
  behind: [] as (() => Promise<void>)[],
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({
  updateTag: (tag: string) => state.steps.push(`updateTag ${tag}`),
  refresh: () => state.steps.push("refresh"),
}));
vi.mock("next/server", async (original) => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  return {
    ...(await original<object>()),
    after: (task: () => Promise<void>) => void state.behind.push(AsyncLocalStorage.bind(task)),
    // Awaited by `runWithIncomingTrace` ahead of the action's body.
    connection: () => Promise.resolve(),
  };
});
vi.mock("./mail", () => ({ drainOutbox: async () => undefined }));
vi.mock("./auth/guards", () => ({
  judgeAdminRequest: async () => {
    state.steps.push("admin guard");
    if (state.actor !== undefined && "session" in state.admin)
      (await import("./requestScope")).setRequestActor({ ...state.actor, lane: "admin" });
    return state.admin;
  },
  passesPasskeyTouch: async () => {
    state.steps.push("passkey touch");
    return state.touch;
  },
  getAccountSession: async () => {
    state.steps.push("account guard");
    return state.account;
  },
}));
vi.mock("./subject", () => ({
  getSubjectSession: async () => {
    state.steps.push("person guard");
    if (state.actor !== undefined && state.subject !== null) (await import("./requestScope")).setRequestActor(state.actor);
    return state.subject;
  },
}));
vi.mock("./turnstile", () => ({
  turnstileRefusal: async (token: string | null) => {
    state.steps.push(`bot check ${String(token)}`);
    return state.botCheck;
  },
}));
vi.mock("./logging", () => ({
  logger: {
    info: (message: string, meta: unknown) => state.lines.push({ level: "info", message, meta }),
    error: (message: string, _error: unknown, meta: unknown) => state.lines.push({ level: "error", message, meta }),
  },
}));

const Venue = z.object({ name: z.string().min(1).max(10), plz: z.string().regex(/^\d{5}$/) });

/** The backend's failure body at `statusCode` with `code`. */
const failure = (statusCode: number, code: Code | undefined) =>
  new APIBadStatusError({
    message: "refused",
    url: "http://backend/api/v0/spielorte",
    statusCode,
    serverErrorCode: code,
    refusedFields: [],
    endpoint: "/spielorte",
    method: "POST",
    readOnly: false,
    traceId: "0",
  });

/** A refusal by its code. */
const refusal = (code: Code) => failure(409, code);

/** A call sent through the transport's dispatch, as the generated client sends each: recorded, and answered at once or with `thrown`. */
const sends = (method: string, readOnly?: boolean, thrown?: unknown) =>
  dispatchRequest(sentRequestOf(method, readOnly), async () => {
    state.steps.push(`sent ${method}${readOnly === true ? " read-only" : ""}`);
    if (thrown !== undefined) throw thrown;
  });

/** An admin create whose body records what it was handed and sends the create, which the backend answers with `thrown` where given. */
function create(thrown?: unknown) {
  return action({
    lane: "admin",
    name: "anlegen",
    input: Venue,
    run: async (input) => {
      state.steps.push(`body ${JSON.stringify(input)}`);
      await sends("POST", undefined, thrown);
      return { ok: true, value: undefined };
    },
  });
}

beforeEach(() => {
  state.admin = { session: {} };
  state.subject = null;
  state.botCheck = null;
  state.touch = true;
  state.account = null;
  state.actor = undefined;
  state.steps = [];
  state.lines = [];
  state.behind = [];
});

describe("the admin lane", () => {
  it.each([
    ["signIn", COPY.shared.failure.signInExpired],
    ["noGrant", COPY.shared.failure.accessGone],
    ["grantGone", COPY.shared.failure.accessGone],
    ["unread", COPY.shared.failure.accessUnchecked],
  ])("turns a caller the guard refuses as %s away in the words of its repair, before anything else", async (refused, reason) => {
    state.admin = { refused };

    expect(await create()({ name: "Nord", plz: "60438" })).toStrictEqual({ ok: false, reason });
    expect(state.steps).toStrictEqual(["admin guard"]);
  });

  it("answers any other throw as the unexpected failure, logging its name alone, and clears the tag", async () => {
    const answer = await create(new Error("lena@example.com was refused"))({ name: "Nord", plz: "60438" });

    expect(answer).toStrictEqual({ ok: false, reason: COPY.shared.failure.unexpected });
    expect(state.lines).toStrictEqual([{ level: "error", message: "action.failed", meta: { action: "anlegen", name: "Error" } }]);
    expect(state.steps.at(-1)).toBe("updateTag site");
  });
});

const Seat = z.object({ team_id: z.string().min(1), saison_id: z.string().min(1) });

/** A signed-in person holding a contact seat at each team and season named, in seasons that grant a panel. */
const seated = (...seats: { team_id: string; saison_id: string }[]) => person({ seats: seats.map((at) => seat(at)) });

describe("the person lane", () => {
  const register = action({
    lane: "person",
    claim: "seat",
    name: "melden",
    input: Seat,
    run: async (_input, { seats }) => {
      state.steps.push(`body ${String(seats.length)}`);
      return { ok: true, value: undefined };
    },
  });

  it("turns away a caller with no session, logging why, before the input is read", async () => {
    // An input the schema refuses: read first, it would answer with the box's message.
    expect(await register({ team_id: "", saison_id: "2027" })).toStrictEqual({ ok: false, reason: COPY.shared.failure.signInExpired });
    expect(state.steps).toStrictEqual(["person guard"]);
    expect(state.lines).toStrictEqual([{ level: "info", message: "roles.refused", meta: { operation: "melden", grund: "keine_sitzung" } }]);
  });

  it.each([
    ["in another season", { team_id: "t1", saison_id: "2026" }],
    ["at another team in the same season", { team_id: "t2", saison_id: "2027" }],
  ])("refuses a seat the person holds %s, naming nothing of the address", async (_where, held) => {
    state.subject = seated(held);

    expect(await register({ team_id: "t1", saison_id: "2027" })).toStrictEqual({ ok: false, reason: COPY.shared.failure.stale });
    expect(state.steps).toStrictEqual(["person guard"]);
    expect(JSON.stringify(state.lines)).not.toContain("@");
  });
});

describe("the passkey touch a lane declares", () => {
  const HOLDER = "inhaberin@example.org";
  const run = async () => {
    state.steps.push("body");
    return { ok: true as const, value: undefined };
  };
  const declared = { name: "passkeyAendern", input: Venue.extend(PAGE_HOLDER), passkey: true } as const;
  const touched = (lane: "admin" | "person") =>
    lane === "admin" ? action({ ...declared, lane, run }) : action({ ...declared, lane, claim: "record", run });

  beforeEach(() => {
    state.subject = person({});
    state.actor = { email: HOLDER, lane: "person", authTime: 0, factor: "passkey" };
  });

  it.each(["admin", "person"] as const)("refuses the %s lane's act its touch fails, before the input is read", async (lane) => {
    state.touch = false;

    // An input the schema refuses: read first, it would answer with the box's message.
    expect(await touched(lane)({ name: "", plz: "x", holder: HOLDER })).toStrictEqual({ ok: false, reason: COPY.signIn.refusal.touchMissing });
    expect(state.steps).toStrictEqual([lane === "admin" ? "admin guard" : "person guard", "passkey touch"]);
  });

  /* The touch on a page whose own session ended signs in whichever account's passkey answers: the act would run as it. */
  it.each(["admin", "person"] as const)("refuses the %s lane's act a touch signed another account in for, running nothing", async (lane) => {
    expect(await touched(lane)({ name: "Nord", plz: "60438", holder: "jemand-anderes@example.org" })).toStrictEqual({
      ok: false,
      reason: COPY.shared.failure.signInExpired,
    });
    expect(state.steps).toStrictEqual([lane === "admin" ? "admin guard" : "person guard", "passkey touch"]);
  });
});

describe("the account's own acts", () => {
  const HOLDER = "kontoinhaberin@example.org";
  const signOut = action({
    lane: "person",
    claim: "account",
    name: "abmelden",
    input: z.object(PAGE_HOLDER),
    run: async (_input, { served }) => {
      state.steps.push(`body ${JSON.stringify(served)}`);
      return { ok: true, value: undefined };
    },
  });

  beforeEach(() => {
    state.subject = person({});
    state.actor = { email: HOLDER, lane: "person", authTime: 0, factor: "code" };
  });

  /* An address holding a grant signed in by its mailed code alone passes the person guard: its mailbox's holder
     would end the administrator's other sessions. */
  it("turns away a session the account's guard refuses, before the input is read", async () => {
    state.account = null;

    // An input the schema refuses: read first, it would answer with the box's message.
    expect(await signOut({ holder: "" })).toStrictEqual({ ok: false, reason: COPY.shared.failure.signInExpired });
    expect(state.steps).toStrictEqual(["person guard", "account guard"]);
  });

  it("runs the body on the session the account's guard judged, for the address its page was drawn for", async () => {
    state.account = { user: { id: "u1" } };

    expect(await signOut({ holder: HOLDER.toUpperCase() })).toStrictEqual({ ok: true, value: undefined });
    expect(state.steps).toStrictEqual(["person guard", "account guard", 'body {"user":{"id":"u1"}}']);
  });
});

describe("the public lane", () => {
  const send = action({
    lane: "public",
    botCheck: true,
    name: "senden",
    input: z.object({ email: z.email() }),
    run: async ({ email }) => {
      state.steps.push("body");
      return { ok: true, value: email };
    },
  });

  it("answers the bot check's refusal before anything of the input is read", async () => {
    state.botCheck = COPY.shared.botCheck.confirm;
    const posted = new FormData();
    posted.set("email", "keine-adresse");
    posted.set("cf-turnstile-response", "token");

    expect(await send(posted)).toStrictEqual({ ok: false, reason: COPY.shared.botCheck.confirm });
    expect(state.steps).toStrictEqual(["bot check token"]);
  });
});

/** An action on `lane` taking a name, its body running `work`: the person's on a record of its own, the public one exempt. */
function onLane(lane: "admin" | "person" | "public", work: () => Promise<unknown>) {
  const declared = { name: lane, input: z.object({ name: z.string().min(1) }) };
  const run = async () => {
    await work();
    return { ok: true, value: undefined } as const;
  };
  switch (lane) {
    case "admin":
      return action({ ...declared, lane, run });
    case "person":
      return action({ ...declared, lane, claim: "record", run });
    case "public":
      return action({ ...declared, lane, exempt: "a case's own action", run });
  }
}

/** What the action did to the site's cache, in order. */
const cacheSteps = () => state.steps.filter((step) => step.startsWith("updateTag") || step === "refresh");

describe("the site's cache", () => {
  beforeEach(() => {
    state.subject = person();
  });

  it.each(["admin", "person", "public"] as const)("is cleared on the %s lane once the body sent a write", async (lane) => {
    await onLane(lane, async () => {
      await sends("GET");
      await sends("POST");
    })({ name: "Nord" });

    expect(cacheSteps()).toStrictEqual(["updateTag site"]);
  });

  it.each([
    ["whose answer never came", new TypeError("fetch failed")],
    ["the backend answered as one that may stand", failure(500, "unknown_outcome")],
    // The server may fail after its commit.
    ["the server failed on", failure(500, "database_failed")],
    ["an edge's own page refused, naming no code", failure(429, undefined)],
  ])("is cleared for a write %s, which may have landed all the same", async (_answer, thrown) => {
    await onLane("admin", () => sends("POST", undefined, thrown))({ name: "Nord" });

    expect(cacheSteps()).toStrictEqual(["updateTag site"]);
  });

  it("is cleared where one write landed before another was refused", async () => {
    await onLane("admin", async () => {
      await sends("POST");
      await sends("PATCH", undefined, refusal("version_stale"));
    })({ name: "Nord" });

    expect(cacheSteps()).toStrictEqual(["updateTag site"]);
  });

  // Next starts the work inside the action's scope; its own scope is what leaves it no actor and a deadline of its own
  // rather than what the action's 30 seconds have left.
  it("stands when the body's write runs behind the response, in a scope of its own", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const behind: { actor: unknown; left: number }[] = [];
    try {
      await onLane("admin", async () => {
        setRequestActor({ email: "admin@example.org", lane: "admin", authTime: 0, factor: "passkey" });
        afterTheResponse(async () => {
          behind.push({ actor: getRequestActor(), left: requestTimeLeft() });
          await sends("POST");
        });
      })({ name: "Nord" });
      clock.mockReturnValue(20000);
      for (const task of state.behind.splice(0)) await task();
    } finally {
      clock.mockRestore();
    }

    expect(state.steps).toStrictEqual(["admin guard", "sent POST"]);
    expect(behind).toStrictEqual([{ actor: undefined, left: AFTER_RESPONSE_DEADLINE_MS }]);
  });
});
