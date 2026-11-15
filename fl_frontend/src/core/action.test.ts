import { answerTheLookup, GRANTED } from "@/test-support/authDoubles.ts";
import { networkFailure, refusal, serveBackend, serveHost } from "@/test-support/backend.ts";
import { cacheCalls } from "@/test-support/nextRequest.ts";
import { signedInRequest } from "@/test-support/session.ts";
import { captureLog } from "@/test-support/stdoutCapture.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { COPY } from "./copy";
import { SERVER_COPY } from "./serverCopy";

import type { FLRefusedField } from "./generated/client/types";

/**
 * Work handed to Next's `after`, run by a case once its action has answered, as Next runs it: bound to the caller's
 * async context, as Next's `after` binds it, so the work starts inside the action's request scope.
 */
const behind = vi.hoisted(() => [] as (() => Promise<void>)[]);

vi.mock("next/server", async (original) => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  return {
    ...(await original<object>()),
    after: (task: () => Promise<void>) => void behind.push(AsyncLocalStorage.bind(task)),
    // Awaited by `runWithIncomingTrace` ahead of the action's body.
    connection: () => Promise.resolve(),
  };
});

/** The endpoint each case's body sends to, each call answered by its entry in `planned`. */
const PROBE = "/probe";

/** Each call the body is about to send, in turn: its method, and the body, refusal or network failure it is answered with. */
const planned: { method: string; answer: unknown }[] = [];

// The body's own calls and nothing else: a request the action sends anywhere else, or by another method, fails its case.
const backend = serveBackend(({ method, path }) => (path === PROBE && planned[0]?.method === method ? planned.shift()?.answer : undefined));
const { arriveAs } = signedInRequest();
/** Every line the real logger writes, read off standard output. */
const log = captureLog();

// Imported here rather than at the top: `vi.doMock` reaches only the modules imported after it.
const { action, numberBox, PAGE_HOLDER } = await import("./action");
const { afterTheResponse } = await import("./afterResponse");
const { sendToBackend } = await import("./api");
const { AFTER_RESPONSE_DEADLINE_MS, getRequestActor, requestTimeLeft } = await import("./requestScope");

/** A person granted nothing, whom a case arrives as for the person lane. */
const PERSON = "spielerin@example.org";

/** Every part of a case's own action body that ran, in order. */
const ran: string[] = [];

/** The body's call to the backend by `method`, answered with `answer`, or with an empty body. */
const sends = (method: string, answer?: Response) => {
  planned.push({ method, answer: answer ?? {} });
  return sendToBackend(PROBE, { method, authType: "base" });
};

/** Each call the body sent, by its method and endpoint. */
const sent = () => backend.sent.map(({ method, path }) => `${method} ${path}`);

const Venue = z.object({ name: z.string().min(1).max(10), postcode: z.string().regex(/^\d{5}$/) });

/** An admin create whose body records what it was handed and sends the create, which the backend answers with `answer` where given. */
function create(answer?: Response) {
  return action({
    lane: "admin",
    name: "create",
    input: Venue,
    run: async (input) => {
      ran.push(`body ${JSON.stringify(input)}`);
      await sends("POST", answer);
      return { ok: true, value: undefined };
    },
  });
}

beforeEach(() => {
  ran.length = 0;
  planned.length = 0;
  behind.length = 0;
});

describe("the admin lane", () => {
  /** Arrives so the administrator's guard refuses as `refused` says. */
  const ARRIVALS = {
    signIn: () => arriveAs(null),
    // A person's code session at an address holding no grant.
    noGrant: () => arriveAs({ email: PERSON }),
    // The file's administrator, signed in by passkey, whose grant the backend now answers gone.
    grantGone: () => answerTheLookup(() => ({ ...GRANTED, admin_tier: null, granted_since: null, account: true })),
    unread: () => answerTheLookup(() => null),
  } as const;

  it.each([
    ["signIn", COPY.shared.failure.signInExpired],
    ["noGrant", COPY.shared.failure.accessGone],
    ["grantGone", COPY.shared.failure.accessGone],
    ["unread", COPY.shared.failure.unexpected],
  ] as const)("turns a caller the guard refuses as %s away in its shared line, before anything else", async (refused, reason) => {
    await ARRIVALS[refused]();

    expect(await create()({ name: "Nord", postcode: "60438" })).toStrictEqual({ ok: false, reason });
    expect({ ran, sent: sent() }, "the body ran, or sent its call").toStrictEqual({ ran: [], sent: [] });
    // The guard's own verdict, never a failure answered in the same line, which logs the action's failure.
    expect(log.lines().filter(({ message }) => message === "action.failed")).toStrictEqual([]);
  });
});

const Seat = z.object({ team_id: z.string().min(1), saison_id: z.string().min(1) });

describe("the person lane", () => {
  const register = action({
    lane: "person",
    claim: "seat",
    name: "melden",
    input: Seat,
    run: async (_input, { seats }) => {
      ran.push(`body ${String(seats.length)}`);
      return { ok: true, value: undefined };
    },
  });

  it("turns away a caller with no session, logging why, before the input is read", async () => {
    await arriveAs(null);

    // An input the schema refuses: read first, it would answer with the box's message.
    expect(await register({ team_id: "", saison_id: "2027" })).toStrictEqual({ ok: false, reason: COPY.shared.failure.signInExpired });
    expect(ran).toStrictEqual([]);
    expect(log.lines().map(({ level, message, fields }) => [level, message, fields])).toStrictEqual([
      ["INFO", "roles.refused", { operation: "melden", reason: "no_session" }],
    ]);
  });
});

describe("the passkey touch a lane declares", () => {
  const run = async () => {
    ran.push("body");
    return { ok: true as const, value: undefined };
  };
  const declared = { name: "passkeyAendern", input: Venue.extend(PAGE_HOLDER), passkey: true } as const;
  const touched = (lane: "admin" | "person") =>
    lane === "admin" ? action({ ...declared, lane, run }) : action({ ...declared, lane, claim: "record", run });

  /* The touch on a page whose own session ended signs in whichever account's passkey answers: the act would run as it. */
  it.each(["admin", "person"] as const)("refuses the %s lane's act a touch signed another account in for, running nothing", async (lane) => {
    // The administrator by passkey just now, and a person holding no passkey, each of whom the touch passes.
    if (lane === "person") await arriveAs({ email: PERSON });

    expect(await touched(lane)({ name: "Nord", postcode: "60438", holder: "jemand-anderes@example.org" })).toStrictEqual({
      ok: false,
      reason: COPY.shared.failure.signInExpired,
    });
    expect(ran).toStrictEqual([]);
  });
});

describe("the account's own acts", () => {
  const HOLDER = "kontoinhaberin@example.org";
  const signOut = action({
    lane: "person",
    claim: "account",
    name: "sign_out",
    input: z.object(PAGE_HOLDER),
    run: async (_input, { served }) => {
      ran.push(`body ${served.user.email}`);
      return { ok: true, value: undefined };
    },
  });

  /* An address holding a grant signed in by its mailed code alone passes the person guard: its mailbox's holder
     would end the administrator's other sessions. */
  it("turns away a session the account's guard refuses, before the input is read", async () => {
    await arriveAs({ email: HOLDER });
    // The address holds a grant, which its code session does not meet.
    answerTheLookup((email) => (email === HOLDER ? GRANTED : undefined));

    // An input the schema refuses: read first, it would answer with the box's message.
    expect(await signOut({ holder: "" })).toStrictEqual({ ok: false, reason: COPY.shared.failure.signInExpired });
    expect(ran).toStrictEqual([]);
  });

  it("runs the body on the session the account's guard judged, for the address its page was drawn for", async () => {
    await arriveAs({ email: HOLDER });

    expect(await signOut({ holder: HOLDER.toUpperCase() })).toStrictEqual({ ok: true, value: undefined });
    expect(ran).toStrictEqual([`body ${HOLDER}`]);
  });
});

describe("the public lane", () => {
  const send = action({
    lane: "public",
    botCheck: true,
    name: "send",
    input: z.object({ email: z.email() }),
    run: async ({ email }) => {
      ran.push("body");
      return { ok: true, value: email };
    },
  });

  it("answers the bot check's refusal before anything of the input is read", async () => {
    // Cloudflare judging the token forged.
    const judged = serveHost("https://challenges.cloudflare.com", ({ method, url }) =>
      method === "POST" && url.pathname === "/turnstile/v0/siteverify"
        ? { success: false, "error-codes": ["invalid-input-response"] }
        : undefined,
    );
    const posted = new FormData();
    posted.set("email", "no-address");
    posted.set("cf-turnstile-response", "token");

    expect(await send(posted)).toStrictEqual({ ok: false, reason: COPY.shared.botCheck });
    expect(judged.map(({ body }) => (body as { response?: unknown }).response)).toStrictEqual(["token"]);
    expect(ran).toStrictEqual([]);
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
const cacheSteps = () =>
  cacheCalls.flatMap(({ name, args }) => (name === "updateTag" ? [`updateTag ${String(args[0])}`] : name === "refresh" ? [name] : []));

describe("the site's cache", () => {
  it.each(["admin", "person", "public"] as const)("is cleared on the %s lane once the body sent a write", async (lane) => {
    if (lane === "person") await arriveAs({ email: PERSON });

    await onLane(lane, async () => {
      await sends("GET");
      await sends("POST");
    })({ name: "Nord" });

    expect(sent()).toStrictEqual([`GET ${PROBE}`, `POST ${PROBE}`]);
    expect(cacheSteps()).toStrictEqual(["updateTag site"]);
  });

  it.each([
    ["whose answer never came", networkFailure()],
    ["the backend answered as one that may stand", refusal("unknown_outcome", { status: 500 })],
    // The server may fail after its commit.
    ["the server failed on", refusal("database_failed", { status: 500 })],
    ["an edge's own page refused, naming no code", new Response("<html>", { status: 429, headers: { "content-type": "text/html" } })],
  ])("is cleared for a write %s, which may have landed all the same", async (_answer, answer) => {
    await onLane("admin", () => sends("POST", answer))({ name: "Nord" });

    expect(sent()).toStrictEqual([`POST ${PROBE}`]);
    expect(cacheSteps()).toStrictEqual(["updateTag site"]);
  });

  it("is cleared where one write landed before another was refused", async () => {
    await onLane("admin", async () => {
      await sends("POST");
      await sends("PATCH", refusal("version_stale"));
    })({ name: "Nord" });

    expect(sent()).toStrictEqual([`POST ${PROBE}`, `PATCH ${PROBE}`]);
    expect(cacheSteps()).toStrictEqual(["updateTag site"]);
  });

  // Next starts the work inside the action's scope; its own scope is what leaves it no actor and a deadline of its own
  // rather than what the action's 30 seconds have left.
  it("stands when the body's write runs behind the response, in a scope of its own", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const seen: { actor: unknown; left: number }[] = [];
    try {
      // Under the actor the administrator's guard recorded for the action.
      const answer = await onLane("admin", async () => {
        afterTheResponse(async () => {
          seen.push({ actor: getRequestActor(), left: requestTimeLeft() });
          await sends("POST");
        });
      })({ name: "Nord" });
      expect(answer).toStrictEqual({ ok: true, value: undefined });
      expect(sent(), "the write behind the response went before the response").toStrictEqual([]);
      clock.mockReturnValue(20000);
      for (const task of behind.splice(0)) await task();
    } finally {
      clock.mockRestore();
    }

    expect(sent()).toStrictEqual([`POST ${PROBE}`]);
    expect(cacheSteps()).toStrictEqual([]);
    expect(seen).toStrictEqual([{ actor: undefined, left: AFTER_RESPONSE_DEADLINE_MS }]);
  });
});

// The harm: a row's refusal shown on another row, on the list's one line where nobody finds the row, or nowhere.
describe("a list of records", () => {
  const { field } = COPY.shared;
  const Report = z.object({ changes: z.object({ scorers: z.array(z.object({ minute: z.string().regex(/^\d{1,3}$/) })).max(3) }) });
  const scorers = (...minutes: string[]) => ({ changes: { scorers: minutes.map((minute) => ({ minute })) } });

  /** A save of the report's rows, which the backend refuses for the third row's minute. */
  const save = (paths: { [path: string]: "changes.scorers" | "changes.scorers.*.minute" }) =>
    action({
      lane: "admin",
      name: "saveBericht",
      input: Report,
      ownWords: ["address_in_free_text"],
      paths,
      examples: { "changes.scorers.*.minute": field.exampleDigits },
      run: async () => {
        const refused: FLRefusedField = { in: "body", kind: "address_in_free_text", ctx: {}, path: ["bericht", "scorers", 2, "minute"] };
        await sends("PUT", refusal("payload_refused", { fields: [refused] }));
        return { ok: true, value: undefined };
      },
    });

  it("answers the form's own check on each row's box and on the list's, the example named for every row", async () => {
    expect(await save({})(scorers("x", "12", "", "9x"))).toStrictEqual({ ok: false, fieldErrors: { "changes.scorers": field.max(3) } });
    expect(await save({})(scorers("x", "", "9x"))).toStrictEqual({
      ok: false,
      fieldErrors: {
        "changes.scorers.0.minute": field.format(field.exampleDigits),
        "changes.scorers.1.minute": field.required,
        "changes.scorers.2.minute": field.format(field.exampleDigits),
      },
    });
    expect(sent(), "a form its own check refused was sent").toStrictEqual([]);
  });

  it("places the backend's refusal of a row's field on that row's box", async () => {
    expect(await save({ "bericht.scorers.*.minute": "changes.scorers.*.minute" })(scorers("12", "45", "90"))).toStrictEqual({
      ok: false,
      errorCode: "payload_refused",
      fieldErrors: { "changes.scorers.2.minute": field.without(COPY.signIn.address) },
    });
  });

  it("answers a row's refusal as a stale page where only its list is declared, never on the list's box", async () => {
    expect(await save({ "bericht.scorers": "changes.scorers" })(scorers("12", "45", "90"))).toStrictEqual({
      ok: false,
      errorCode: "payload_refused",
      reason: COPY.shared.failure.stale,
    });
  });
});

// The harm: a dialog closed behind the passkey touch answers in a toast, where a box's phrase has no box in sight and the
// line pointing at the fields points at nothing.
describe("a screen showing no box with its answer", () => {
  const { format, reasonMissing, reasonWithAddress } = SERVER_COPY.closedDialog;
  const Ban = z.object({
    email: z.string().refine((value) => value.includes("@")),
    ban_reason: z
      .string()
      .min(1)
      .regex(/^[^|]*$/),
  });

  /** A ban whose backend refuses what `refused` names, or takes it. */
  const ban = (refused?: FLRefusedField) =>
    action({
      lane: "admin",
      name: "enterBan",
      input: Ban,
      ownWords: ["address_in_free_text", "email_not_accepted"],
      paths: { email: "email", ban_reason: "ban_reason" },
      boxless: {
        email: { value: format.address, email_not_accepted: format.address },
        ban_reason: { required: reasonMissing, address_in_free_text: reasonWithAddress },
      },
      run: async () => {
        await sends("POST", refused === undefined ? undefined : refusal("payload_refused", { fields: [refused] }));
        return { ok: true, value: undefined };
      },
    });

  it("answers a box its own rule refused in the box's sentence, by whether it held anything once stripped", async () => {
    expect(await ban()({ email: "max", ban_reason: "Ein Grund" })).toStrictEqual({ ok: false, reason: format.address });
    expect(await ban()({ email: "max@example.org", ban_reason: "   " })).toStrictEqual({ ok: false, reason: reasonMissing });
  });

  it("answers a box the backend's rule refused in the sentence declared for that rule", async () => {
    const refused: FLRefusedField = { in: "body", kind: "address_in_free_text", ctx: {}, path: ["ban_reason"] };

    expect(await ban(refused)({ email: "max@example.org", ban_reason: "max@example.org" })).toStrictEqual({
      ok: false,
      errorCode: "payload_refused",
      reason: reasonWithAddress,
    });
  });

  it("answers a refusal of a box it declares no sentence for as one it does not word, never with the box's phrase", async () => {
    expect(await ban()({ email: "max@example.org", ban_reason: "a|b" })).toStrictEqual({ ok: false, reason: COPY.shared.failure.unexpected });
  });
});

// An empty box read as 0 would store a fee or a price nobody typed, which a page that only reads it back shows as a
// plausible figure.
describe("a box's reading", () => {
  const FEE = z.int().min(0);

  it("reads an empty digit box as no value, never as 0", () => {
    expect(numberBox(z.union([FEE, z.null()])).safeParse("")).toStrictEqual({ success: true, data: null });
    expect(numberBox(FEE).safeParse("").success).toBe(false);
  });
});
