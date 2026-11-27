import { assert, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ADMIN_EMAIL, answerTheLookup, GRANTED } from "@/test-support/authDoubles";
import { networkFailure, refusal, serveBackend, serveHost } from "@/test-support/backend";
import { cacheCalls } from "@/test-support/nextRequest";
import { posted } from "@/test-support/posted";
import { signedInRequest } from "@/test-support/session";
import { captureLog } from "@/test-support/stdoutCapture";

import { COPY } from "./copy/shared";
import { dayOf } from "./format";
import { SERVER_COPY } from "./serverCopy";

import type { Fault, Faulted, LaneAnswer } from "./action";
import type { Code, FLRefusedField } from "./generated/client/types";

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
const { arriveAs, store } = signedInRequest();
/** Every line the real logger writes, read off standard output. */
const log = captureLog();

// Imported here rather than at the top: `vi.doMock` reaches only the modules imported after it.
const { action, besideRefusal, fault, numberBox, PAGE_HOLDER } = await import("./action");
const { afterTheResponse } = await import("./afterResponse");
const { sendToBackend } = await import("./api");
const { boundCall, getRequestActor, REQUEST_DEADLINE_MS } = await import("./requestScope");

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

/** Whether a line carries an address anywhere, as typed or as the placeholder the logger scrubs one to. */
const carriesAnAddress = (raw: string): boolean => raw.includes("@") || raw.includes("[address]");

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
    unread: () => answerTheLookup(() => null),
  } as const;

  it.each([
    ["signIn", COPY.shared.failure.signInExpired],
    ["noGrant", COPY.shared.failure.accessGone],
    ["unread", COPY.shared.failure.unexpected],
  ] as const)("turns a caller the guard refuses as %s away in its shared line, before anything else", async (refused, reason) => {
    await ARRIVALS[refused]();

    expect(await create()({ name: "Nord", postcode: "60438" })).toStrictEqual({ ok: false, reason });
    expect({ ran, sent: sent() }, "the body ran, or sent its call").toStrictEqual({ ran: [], sent: [] });
    // The guard's own verdict, never a failure answered in the same line, which logs the action's failure.
    expect(log.lines().filter(({ message }) => message === "action.failed")).toStrictEqual([]);
  });

  const ADDRESS = "lena@example.com";
  /** An admin create whose body sends the create and then throws, its message naming an address. */
  const throwing = action({
    lane: "admin",
    name: "create",
    input: z.object({ name: z.string().min(1) }),
    run: async () => {
      await sends("POST");
      throw new Error(`${ADDRESS} was refused`);
    },
  });

  it("answers any other throw as the unexpected failure, logging its name alone, and clears the tag", async () => {
    // The file's visitor was signed in before the case, on a line of its own.
    log.clear();
    const answer = await throwing({ name: "Nord" });

    expect(answer).toStrictEqual({ ok: false, reason: COPY.shared.failure.unexpected });
    const lines = log.lines();
    expect(lines.map(({ level, message, fields }) => [level, message, fields])).toStrictEqual([
      ["ERROR", "action.failed", { action: "create", name: "Error" }],
    ]);
    for (const { error, raw } of lines) {
      expect(error, "the thrown error reached the line").toBe(undefined);
      assert.ok(!carriesAnAddress(raw), `the error's message reached the line: ${raw}`);
    }
    expect(sent()).toStrictEqual([`POST ${PROBE}`]);
    expect(cacheCalls.filter(({ name }) => name === "updateTag").map(({ args }) => args[0])).toStrictEqual(["site"]);
  });
});

describe("the person lane", () => {
  const register = action({
    lane: "person",
    claim: "record",
    name: "melden",
    input: z.object({ team_id: z.string().min(1), saison_id: z.string().min(1) }),
    run: async () => {
      ran.push("body");
      return { ok: true, value: undefined };
    },
  });

  it("turns away a caller with no session, logging why, before the input is read", async () => {
    await arriveAs(null);
    // The file's visitor was signed in before the case, on a line of its own.
    log.clear();

    // An input the schema refuses: read first, it would answer with the box's message.
    expect(await register({ team_id: "", saison_id: "2027" })).toStrictEqual({ ok: false, reason: COPY.shared.failure.signInExpired });
    expect(ran).toStrictEqual([]);
    expect(log.lines().map(({ level, message, fields }) => [level, message, fields])).toStrictEqual([
      ["INFO", "roles.refused", { operation: "melden", reason: "no_session" }],
    ]);
  });

  // The harm: the grant gone between the guard's read and the backend's answered as a crash, which says nothing of why.
  it("words the guard's own lookup the backend refused by its code, logging no failure", async () => {
    await arriveAs({ email: PERSON });
    // The guard's lookup of the person's records, past the sign-in's, reaches the case's own answer.
    answerTheLookup(() => undefined);
    backend.answerWith(({ method, path }) => (method === "POST" && path === "/identity/subject" ? refusal("actor_not_admin") : undefined));
    log.clear();

    expect(await register({ team_id: "t1", saison_id: "2027" })).toStrictEqual({
      ok: false,
      errorCode: "actor_not_admin",
      reason: COPY.shared.failure.accessGone,
    });
    expect(ran).toStrictEqual([]);
    expect(log.lines().filter(({ message }) => message === "action.failed")).toStrictEqual([]);
  });
});

describe("the passkey touch a lane declares", () => {
  const run = async () => {
    ran.push("body");
    return { ok: true as const, value: undefined };
  };
  const declared = { name: "passkeyAendern", input: Venue.extend(PAGE_HOLDER), passkey: true } as const;
  const touched = (lane: "admin" | "person") =>
    lane === "admin" ? action({ ...declared, lane, run }) : action({ ...declared, lane, claim: "account", run });

  /* The touch on a page whose own session ended signs in whichever account's passkey answers: the act would run as it. */
  it.each(["admin", "person"] as const)("refuses the %s lane's act a touch signed another account in for, running nothing", async (lane) => {
    // The administrator by passkey just now, and a person at an address holding no grant, each of whom the touch passes.
    if (lane === "person") await arriveAs({ email: PERSON });

    expect(await touched(lane)({ name: "Nord", postcode: "60438", holder: "jemand-anderes@example.org" })).toStrictEqual({
      ok: false,
      reason: COPY.shared.failure.signInExpired,
    });
    expect(ran).toStrictEqual([]);
  });

  /* The harm: a grant read as none would let a mailbox's code session erase an administrator's account, or move its
     address, with no touch, and nothing would show it. */
  it("runs nothing where the account's guard reads no grant, answering the shared failure line", async () => {
    // The administrator's address signed in by its mailed code alone, which the person guard serves.
    await arriveAs({ email: PERSON });
    // The person guard's read answers the address's grant; the account guard's, the next, fails on the network.
    let reads = 0;
    answerTheLookup((email) => {
      if (email !== PERSON) return undefined;
      reads += 1;
      return reads === 1 ? { ...GRANTED, account: true } : null;
    });

    expect(await touched("person")({ name: "Nord", postcode: "60438", holder: PERSON })).toStrictEqual({
      ok: false,
      reason: COPY.shared.failure.unexpected,
    });
    expect(ran).toStrictEqual([]);
    expect(reads, "the account's guard read no grant of its own").toBe(2);
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
    const form = posted({ email: "no-address", "cf-turnstile-response": "token" });

    expect(await send(form)).toStrictEqual({ ok: false, reason: COPY.shared.botCheck });
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
      return action({ ...declared, lane, exempt: "mailedLink", run });
  }
}

/** What the action did to the site's cache, in order, an expiry with the profile it was handed. */
const cacheSteps = () =>
  cacheCalls.flatMap(({ name, args }) => {
    switch (name) {
      case "updateTag":
        return [`updateTag ${String(args[0])}`];
      case "revalidateTag":
        return [`revalidateTag ${String(args[0])} ${JSON.stringify(args[1])}`];
      case "refresh":
        return [name];
      default:
        return [];
    }
  });

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

  /* The harm: the same response's render replaces a visitor's form with the error card, its typed answers and its replay
     key lost, so a second press after an outage makes a second write. */
  it.each([
    ["whose answer never came", networkFailure()],
    ["the backend answered as one that may stand", refusal("unknown_outcome", { status: 500 })],
  ])("is expired without a render on the public lane for a write %s", async (_answer, answer) => {
    const answered = await onLane("public", () => sends("POST", answer))({ name: "Nord" });

    expect(answered).toMatchObject({ ok: false, reason: COPY.shared.failure.unexpected });
    expect(cacheCalls.map(({ name, args: [tag] }) => `${name} ${String(tag)}`)).toStrictEqual(["revalidateTag site"]);
    // `{ expire: 0 }`, or no profile, renders the page again in the same response, as `updateTag` does.
    const profile = cacheCalls[0]?.args[1] as { readonly expire?: unknown } | undefined;
    expect(Object.keys(profile ?? {})).toStrictEqual(["expire"]);
    expect(profile?.expire).toBeGreaterThan(0);
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
    const bounds = vi.spyOn(AbortSignal, "timeout");
    const seen: { actor: unknown; bound: unknown }[] = [];
    try {
      // Under the actor the administrator's guard recorded for the action.
      const answer = await onLane("admin", async () => {
        afterTheResponse(async () => {
          // A bound past the deadline's length, so the call is cut to what the work's deadline has left: the action's
          // 10 seconds where it inherited them, its own 30, or the bound itself where no scope encloses it.
          boundCall(REQUEST_DEADLINE_MS + 1);
          seen.push({ actor: getRequestActor(), bound: bounds.mock.calls.at(-1)?.[0] });
          await sends("POST");
        });
      })({ name: "Nord" });
      expect(answer).toStrictEqual({ ok: true, value: undefined });
      expect(sent(), "the write behind the response went before the response").toStrictEqual([]);
      clock.mockReturnValue(20000);
      for (const task of behind.splice(0)) await task();
    } finally {
      clock.mockRestore();
      bounds.mockRestore();
    }

    expect(sent()).toStrictEqual([`POST ${PROBE}`]);
    expect(cacheSteps()).toStrictEqual([]);
    expect(seen).toStrictEqual([{ actor: undefined, bound: REQUEST_DEADLINE_MS }]);
  });
});

// The harm: the backend's refusal of a box the screen shows answered away from that box, where nobody finds what to fix.
describe("a refused field's box", () => {
  const { field } = COPY.shared;

  /** A seat's address, sent beside the record's id the form carries unseen, which the backend refuses for `refusedAt`. */
  const writeSeat = (refusedAt: string) =>
    action({
      lane: "admin",
      name: "writeSeat",
      input: z.object({ id: z.string().min(1), email: z.email() }),
      boxes: ["email"],
      run: async () => {
        const refused: FLRefusedField = { in: "body", kind: "kontakt_email_taken", ctx: {}, path: [refusedAt] };
        await sends("PUT", refusal("kontakt_email_taken", { fields: [refused] }));
        return { ok: true, value: undefined };
      },
    });
  const SEAT = { id: "6890a1b2c3d4e5f607190001", email: "lena@example.com" };

  it("places the backend's refusal of a box the screen shows on that box", async () => {
    expect(await writeSeat("email")(SEAT)).toStrictEqual({
      ok: false,
      errorCode: "kontakt_email_taken",
      fieldErrors: { email: field.taken },
      kinds: { email: "kontakt_email_taken" },
    });
  });
});

/* The harm: a refusal naming several faults said by its first one's code alone, a fault worded on the status line
   though its box stands on the screen, or the whole answer dropped to the stale-page line for one fault the screen
   shows no box for, each leaving the person to find by repeated presses what the save refuses. */
describe("a refusal naming several faults", () => {
  const { field } = COPY.shared;
  const { stale } = COPY.shared.failure;
  const Fixture = z.object({ spielort: z.string().optional(), date: z.string().optional(), media: z.boolean().optional() });
  const at = (kind: string, path: FLRefusedField["path"], ctx: FLRefusedField["ctx"] = {}): FLRefusedField => ({ in: "body", kind, ctx, path });

  /** A save showing `boxes` that the backend refuses with `code`, naming `faults`. */
  const save = (boxes: readonly ("spielort" | "date" | "media")[], code: Code, faults: readonly FLRefusedField[]) =>
    action({
      lane: "admin",
      name: "saveFixture",
      input: Fixture,
      boxes,
      run: async () => {
        await sends("PUT", refusal(code, { fields: faults }));
        return { ok: true, value: undefined };
      },
    });
  const SENT = {};

  it("words each fault by its own kind on its own box", async () => {
    const faults = [at("spiel_double_booked", ["spielort"]), at("spiel_outside_spieltag", ["date"], { earliest: "2027-03-01" })];

    expect(await save(["spielort", "date"], "spiel_double_booked", faults)(SENT)).toStrictEqual({
      ok: false,
      errorCode: "spiel_double_booked",
      fieldErrors: { spielort: field.taken, date: field.earliest(dayOf("2027-03-01")) },
      kinds: { spielort: "spiel_double_booked", date: "spiel_outside_spieltag" },
    });
  });

  it("says a fault on a box the screen does not show in its sentence, the faults it shows staying on their boxes", async () => {
    const faults = [at("spiel_double_booked", ["spielort"]), at("spiel_outside_spieltag", ["date"], { earliest: "2027-03-01" })];

    expect(await save(["date"], "spiel_double_booked", faults)(SENT)).toStrictEqual({
      ok: false,
      errorCode: "spiel_double_booked",
      fieldErrors: { date: field.earliest(dayOf("2027-03-01")) },
      kinds: { date: "spiel_outside_spieltag" },
      reason: SERVER_COPY.refusalLine.spiel_double_booked.spielort,
    });
  });

  // The adoption of a proposed date answers the save's faults on a page holding none of the save's boxes.
  it("says a fault in its sentence where the screen shows no box at all", async () => {
    expect(await save([], "spiel_double_booked", [at("spiel_double_booked", ["schiedsrichter"])])(SENT)).toStrictEqual({
      ok: false,
      errorCode: "spiel_double_booked",
      reason: SERVER_COPY.refusalLine.spiel_double_booked.schiedsrichter,
    });
  });

  it("answers the stale-page line beside the boxes it places, for a fault it can neither place nor say", async () => {
    const faults = [at("duplicate_key", ["name"]), at("spiel_double_booked", ["spielort"])];

    expect(await save(["spielort"], "duplicate_key", faults)(SENT)).toStrictEqual({
      ok: false,
      errorCode: "duplicate_key",
      fieldErrors: { spielort: field.taken },
      kinds: { spielort: "spiel_double_booked" },
      reason: stale,
    });
  });

  // A media consent refused for an age under its floor, which the switch's own closed phrase words.
  it("words a media consent refused for its age by the floor the fault carries", async () => {
    expect(await save(["media"], "media_age", [at("media_age", ["media"], { min: 16 })])(SENT)).toStrictEqual({
      ok: false,
      errorCode: "media_age",
      fieldErrors: { media: COPY.shared.mediaFrom(16) },
      kinds: { media: "media_age" },
    });
  });
});

/* The harm: a lane's own check wording a box in words of its own, or answering on the status line what stands on a box,
   past the one mapping every backend fault goes through. */
describe("a lane's own faults", () => {
  const { field } = COPY.shared;
  const Form = z.object({ address: z.string(), email: z.string() });
  const FORM = { address: "paul@example.org", email: "paul.neu@example.org" };

  /** A lane whose own judge finds `own`, beside the backend's answer to its call where `answer` is given. */
  const judging = (own: readonly Fault[], answer?: Response) =>
    action({
      lane: "admin",
      name: "judged",
      input: Form,
      boxes: ["address", "email"],
      run: async (): Promise<LaneAnswer> => {
        try {
          await sends("POST", answer);
        } catch (failed) {
          return besideRefusal(own, failed);
        }
        return { ok: false, faults: own };
      },
    });

  it("places a lane's fault on its box in the phrase its kind words, and a required box's in the parse's word", async () => {
    const own = [fault("email", "address_change_taken"), fault("address", "required")];

    expect(await judging(own)(FORM)).toStrictEqual({
      ok: false,
      errorCode: "address_change_taken",
      fieldErrors: { email: field.taken, address: field.required },
      kinds: { email: "address_change_taken", address: "required" },
    });
  });

  it("names its own faults and the backend's in one answer", async () => {
    const barred = { in: "body", kind: "address_barred", ctx: {}, path: ["address"] } satisfies FLRefusedField;

    expect(await judging([fault("email", "address_change_taken")], refusal("address_barred", { fields: [barred] }))(FORM)).toStrictEqual({
      ok: false,
      errorCode: "address_barred",
      fieldErrors: { address: field.barred, email: field.taken },
      kinds: { address: "address_barred", email: "address_change_taken" },
    });
  });

  // A gate means no field past it, so its own sentence stands alone.
  it("answers the backend's refusal naming no field alone", async () => {
    expect(await judging([fault("email", "address_change_taken")], refusal("saison_past"))(FORM)).toStrictEqual({
      ok: false,
      errorCode: "saison_past",
      reason: SERVER_COPY.refusalLine.saison_past,
    });
  });
});

/* The harm: a refusal the catalogue words answered as a failure naming no reason on a screen that did not expect it,
   or a refusal of the request answered as an outage, which sends the person to retry what the API refuses again. */
describe("a refusal's line", () => {
  const { stale, unexpected } = COPY.shared.failure;

  /** A write showing no box, which the backend refuses with `answer`. */
  const save = (answer: Response) =>
    action({
      lane: "admin",
      name: "save",
      input: z.object({ id: z.string().min(1) }),
      run: async () => {
        await sends("PUT", answer);
        return { ok: true, value: undefined };
      },
    });

  it.each([
    ["a code the catalogue holds a sentence for", "saison_past", SERVER_COPY.refusalLine.saison_past],
    ["a code no catalogue entry words", "retire_blocked", stale],
    ["a code whose field phrase names no box here", "duplicate_key", stale],
    ["a code whose sentence is the field's, naming none", "booking_unknown_resource", stale],
    ["a code refusing nothing the request asked", "session_refused", unexpected],
    ["the store's failure", "database_failed", unexpected],
  ] as const)("answers %s in its line on any screen", async (_case, code, reason) => {
    expect(await save(refusal(code))({ id: "6890a1b2c3d4e5f607190001" })).toStrictEqual({ ok: false, errorCode: code, reason });
  });

  // A page older than the API: the bound's name moved between the page's read and the press.
  it("answers a refusal missing the bound its phrase names as a stale page, never as an outage", async () => {
    const refused: FLRefusedField = { in: "body", kind: "rules_gruppen_in_use", ctx: {}, path: ["id"] };
    const answer = refusal("rules_gruppen_in_use", { fields: [refused] });

    expect(await save(answer)({ id: "6890a1b2c3d4e5f607190001" })).toStrictEqual({
      ok: false,
      errorCode: "rules_gruppen_in_use",
      reason: stale,
    });
  });
});

// The harm: a row's refusal shown on another row, on the list's one line where nobody finds the row, or nowhere.
describe("a list of records", () => {
  const { field } = COPY.shared;
  const Report = z.object({ changes: z.object({ scorers: z.array(z.object({ minute: z.string().regex(/^\d{1,3}$/) })).max(3) }) });
  const scorers = (...minutes: string[]) => ({ changes: { scorers: minutes.map((minute) => ({ minute })) } });

  /** A save of the report's rows, which the backend refuses for the third row's minute, by the path `refusedAt` gives. */
  const save = (
    paths: { [path: string]: "changes.scorers" | "changes.scorers.*.minute" },
    refusedAt: readonly string[] = ["bericht", "scorers"],
  ) =>
    action({
      lane: "admin",
      name: "saveBericht",
      input: Report,
      paths,
      examples: { "changes.scorers.*.minute": field.exampleDigits },
      run: async () => {
        const refused: FLRefusedField = { in: "body", kind: "nichtantreten_with_scorers", ctx: {}, path: [...refusedAt, 2, "minute"] };
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
      fieldErrors: { "changes.scorers.2.minute": field.without(COPY.spielplan.scorers) },
      kinds: { "changes.scorers.2.minute": "nichtantreten_with_scorers" },
    });
  });

  // The harm: an editor's box added without a `paths` entry answers the backend's refusal of it with the shared line.
  it("places the backend's refusal of a path the editor's changes hold on that box, no path declared", async () => {
    expect(await save({}, ["scorers"])(scorers("12", "45", "90"))).toStrictEqual({
      ok: false,
      errorCode: "payload_refused",
      fieldErrors: { "changes.scorers.2.minute": field.without(COPY.spielplan.scorers) },
      kinds: { "changes.scorers.2.minute": "nichtantreten_with_scorers" },
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

// The harm: a dry run passes no touch, so a call taken for one where its lane declares none, or a body sending its write
// on one, would write behind no touch, which neither the type check nor any page shows.
describe("a dry run a lane declares", () => {
  const VENUE = { name: "Nord", postcode: "60438", holder: ADMIN_EMAIL };
  const Input = Venue.extend(PAGE_HOLDER);
  const judged = action({
    lane: "admin",
    name: "anlegen",
    input: Input,
    passkey: true,
    dryRun: true,
    run: async (_input, { dryRun }) => {
      ran.push(`body ${String(dryRun)}`);
      return { ok: true, value: undefined };
    },
  });
  /** A lane declaring its dry run whose body sends its write on it as well. */
  const writingOnItsDryRun = action({
    lane: "admin",
    name: "anlegen",
    input: Input,
    passkey: true,
    dryRun: true,
    run: async () => {
      await sends("POST");
      return { ok: true, value: undefined };
    },
  });
  const undeclared = action({
    lane: "admin",
    name: "anlegen",
    input: Input,
    passkey: true,
    run: async () => {
      ran.push("body");
      return { ok: true, value: undefined };
    },
  });

  /** The administrator's passkey sign-in of two minutes ago, which the guard admits and the touch does not. */
  const withoutAFreshTouch = () => {
    const [row] = store.session;
    if (row === undefined) throw new Error("the administrator's arrival wrote no session");
    row.createdAt = new Date(Date.now() - 2 * 60 * 1000);
  };

  it("passes the dry run past the touch, telling the body, and judges the touch on the write", async () => {
    withoutAFreshTouch();

    expect(await judged(VENUE, true)).toStrictEqual({ ok: true, value: undefined });
    expect(await judged(VENUE)).toStrictEqual({ ok: false, reason: COPY.shared.touchMissing });
    expect(ran).toStrictEqual(["body true"]);
  });

  it("judges the touch on a lane declaring none, and on a second argument other than `true`", async () => {
    withoutAFreshTouch();

    // As the browser may send it: a server action's arguments are whatever the request carries.
    expect(await Reflect.apply(undeclared, undefined, [VENUE, true])).toStrictEqual({ ok: false, reason: COPY.shared.touchMissing });
    expect(await judged(VENUE, "true" as never)).toStrictEqual({ ok: false, reason: COPY.shared.touchMissing });
    expect(ran).toStrictEqual([]);
  });

  it("refuses a write its body sends on the dry run before it leaves, answering the shared failure line", async () => {
    withoutAFreshTouch();
    log.clear();

    expect(await writingOnItsDryRun(VENUE, true)).toStrictEqual({ ok: false, reason: COPY.shared.failure.unexpected });
    expect(sent()).toStrictEqual([]);
    expect(log.lines().map(({ message }) => message)).toContain("action.failed");
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

// The harm: a lane handing on a fault it built in the backend's shape, whose kind is any string, and the box reading
// the stale-page line in place of its phrase, with nothing failing.
describe("a lane's faults", () => {
  it("take a fault in the backend's shape only as the backend's answer brought it", () => {
    const handed = (faults: Faulted["faults"]) => faults;
    handed([fault("name", "required")]);
    // @ts-expect-error -- the refusal under test: a backend fault built by hand, its kind no field code.
    handed([{ in: "body", kind: "made_up", ctx: {}, path: ["name"] }]);
  });
});
