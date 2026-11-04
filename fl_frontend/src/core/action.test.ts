import { redirect } from "next/navigation";

import { bodyField, refusedPayload } from "@/test-support/refusedPayload.ts";
import { person, seat } from "@/test-support/subjectFixtures.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { action, TOUCH_HOLDER } from "./action";
import { afterTheResponse } from "./afterResponse";
import { dispatchRequest, sentRequestOf } from "./apiDispatch";
import { COPY } from "./copy";
import { APIBadStatusError } from "./errors";
import { AFTER_RESPONSE_DEADLINE_MS, getRequestActor, requestTimeLeft, setRequestActor } from "./requestScope";
import { SERVER_COPY } from "./serverCopy";

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
  getKontoSession: async () => {
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

/** The backend's failure body at `statusCode` with `code`, naming each body path given, as the backend names a code's fields. */
const failure = (statusCode: number, code: Code | undefined, ...paths: (string | number)[][]) =>
  new APIBadStatusError({
    message: "refused",
    url: "http://backend/api/v0/spielorte",
    statusCode,
    serverErrorCode: code,
    refusedFields: code === undefined ? [] : paths.map((path) => bodyField(path, code)),
    endpoint: "/spielorte",
    method: "POST",
    readOnly: false,
    traceId: "0",
  });

/** A refusal by its code, naming each body path given. */
const refusal = (code: Code, ...paths: (string | number)[][]) => failure(409, code, ...paths);

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
    ownWords: ["duplicate_key", "spiel_double_booked", "saison_past"],
    paths: { name: "name" },
    examples: { plz: COPY.verwaltung.spielort.plzExample },
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

  it("strips every text as the backend does, parses it and runs the body", async () => {
    const posted = new FormData();
    posted.set("name", "\u00a0Nord\u3000");
    // U+001F is no White_Space, which Python's `str.strip` drops all the same.
    posted.set("plz", " 60438\u001f");

    expect(await create()(posted)).toStrictEqual({ ok: true, value: undefined });
    expect(state.steps).toStrictEqual(["admin guard", 'body {"name":"Nord","plz":"60438"}', "sent POST", "updateTag site"]);
  });

  it("keeps a character the backend's strip keeps", async () => {
    // U+FEFF is no White_Space, which JavaScript's `trim` would drop and Python's `str.strip` keeps.
    await create()({ name: "\ufeffNord", plz: "60438" });
    expect(state.steps[1]).toBe(`body {"name":"\ufeffNord","plz":"60438"}`);
  });

  it("places a value its schema refuses on its box in the German map's words, sending nothing", async () => {
    expect(await create()({ name: "Sportpark Nordwest", plz: "6043" })).toStrictEqual({
      ok: false,
      fieldErrors: { name: COPY.shared.field.maxChars(10), plz: COPY.shared.field.format(COPY.verwaltung.spielort.plzExample) },
    });
    expect(state.steps).toStrictEqual(["admin guard"]);
  });

  it("keeps two boxes apart whose paths end in one name, keying each by its whole path", async () => {
    const Side = z.object({ tore: z.number().min(0).max(99) });
    const ergebnis = (thrown?: unknown) =>
      action({
        lane: "admin",
        name: "ergebnis",
        input: z.object({ team1: Side, team2: Side }),
        ownWords: ["state_ergebnis_on_a_non_event"],
        paths: { "team2.tore": "team2.tore" },
        run: async () => {
          if (thrown !== undefined) throw thrown;
          return { ok: true, value: undefined };
        },
      });

    expect(await ergebnis()({ team1: { tore: -1 }, team2: { tore: 100 } })).toStrictEqual({
      ok: false,
      fieldErrors: { "team1.tore": COPY.shared.field.between(0, 99), "team2.tore": COPY.shared.field.between(0, 99) },
    });
    expect(
      await ergebnis(refusal("state_ergebnis_on_a_non_event", ["team2", "tore"]))({ team1: { tore: 1 }, team2: { tore: 2 } }),
    ).toStrictEqual({
      ok: false,
      errorCode: "state_ergebnis_on_a_non_event",
      fieldErrors: { "team2.tore": SERVER_COPY.refusal["state_ergebnis_on_a_non_event"] },
    });
  });

  it("places a code its screen words: a phrase on the box of the path the backend names, a sentence on the status line", async () => {
    expect(await create(refusal("duplicate_key", ["name"]))({ name: "Nord", plz: "60438" })).toStrictEqual({
      ok: false,
      errorCode: "duplicate_key",
      fieldErrors: { name: SERVER_COPY.refusal["duplicate_key"] },
    });
    expect(await create(refusal("spiel_double_booked", ["schiedsrichter", "schiedsrichter_id"]))({ name: "Nord", plz: "60438" })).toStrictEqual(
      {
        ok: false,
        errorCode: "spiel_double_booked",
        reason: SERVER_COPY.refusalLine.spiel_double_booked.schiedsrichter,
      },
    );
  });

  it("never sets a field's phrase on the status line without its field, nor a sentence for a field it does not name", async () => {
    // A phrase for a box the screen does not declare would have no subject; a sentence keyed by its field has none for
    // no field or another one. The shared line answers each.
    for (const thrown of [refusal("spiel_double_booked"), refusal("spiel_double_booked", ["datum"]), refusal("duplicate_key", ["plz"])]) {
      expect(await create(thrown)({ name: "Nord", plz: "60438" })).toStrictEqual({
        ok: false,
        errorCode: thrown.serverErrorCode,
        reason: COPY.shared.failure.unexpected,
      });
    }
  });

  // A refusal of the write as a whole: the shared line would send the admin to a retry the same rule refuses again.
  it("answers a code naming no field with its own line where the screen words it, and the shared line where it does not", async () => {
    expect(await create(refusal("saison_past"))({ name: "Nord", plz: "60438" })).toStrictEqual({
      ok: false,
      errorCode: "saison_past",
      reason: SERVER_COPY.refusalLine["saison_past"],
    });
    const unworded = action({ lane: "admin", name: "anlegen", input: Venue, run: () => Promise.reject(refusal("saison_past")) });
    expect(await unworded({ name: "Nord", plz: "60438" })).toStrictEqual({
      ok: false,
      errorCode: "saison_past",
      reason: COPY.shared.failure.unexpected,
    });
  });

  it("places each rule a refused payload broke by its path, and answers the stale line where the screen cannot", async () => {
    const kontakte = (thrown: unknown) =>
      action({
        lane: "admin",
        name: "kontakte",
        input: z.object({ kontakte: z.array(z.object({ email: z.string() })), datum: z.string() }),
        ownWords: ["kontakt_email_twice", "date_not_in_calendar", "good_spieler_exceed_kader", "elfmeterschiessen_without_draw"],
        paths: { kontakte: "kontakte", datum: "datum" },
        run: async () => {
          throw thrown;
        },
      });
    const input = { kontakte: [{ email: "lena@example.com" }], datum: "2027-02-30" };

    const twoRules = refusedPayload([bodyField(["kontakte"], "kontakt_email_twice"), bodyField(["datum"], "date_not_in_calendar")]);
    expect(await kontakte(twoRules)(input)).toStrictEqual({
      ok: false,
      errorCode: "payload_refused",
      fieldErrors: {
        kontakte: COPY.shared.field.taken,
        datum: COPY.shared.field.format(COPY.shared.field.exampleDate),
      },
    });
    // A rule a pattern words takes its line from the bound the rule's context names, and one no pattern words its
    // sentence: both stand, the box's phrase and the status line's sentence, in the one answer.
    const boxAndLine = refusedPayload([
      bodyField(["datum"], "good_spieler_exceed_kader", { max: 8 }),
      bodyField(["kontakte"], "elfmeterschiessen_without_draw"),
    ]);
    expect(await kontakte(boxAndLine)(input)).toStrictEqual({
      ok: false,
      errorCode: "payload_refused",
      fieldErrors: { datum: COPY.shared.field.max(8) },
      reason: SERVER_COPY.ruleLine.elfmeterschiessen_without_draw,
    });
    // One rule the screen does not word, a published bound among them, or one naming no field it shows: the page is
    // older than the API, and no rule's phrase reaches the status line bare.
    for (const [path, kind] of [
      [["datum"], "kontakt_telefon_twice"],
      [["datum"], "string_too_long"],
      [[], "good_spieler_exceed_kader"],
      // A field the screen shows no box for: its phrase has no subject on the status line.
      [["kader"], "good_spieler_exceed_kader"],
    ] as const) {
      expect(
        await kontakte(refusedPayload([bodyField(["kontakte"], "kontakt_email_twice"), bodyField(path, kind, { max: 8 })]))(input),
        kind,
      ).toStrictEqual({
        ok: false,
        errorCode: "payload_refused",
        reason: COPY.shared.failure.stale,
      });
    }
  });

  it("answers every other code on the shared line its kind takes, clearing the tag behind none", async () => {
    expect(await create(refusal("document_not_found"))({ name: "Nord", plz: "60438" })).toMatchObject({ reason: COPY.shared.failure.stale });
    expect(await create(refusal("actor_not_admin"))({ name: "Nord", plz: "60438" })).toMatchObject({ reason: COPY.shared.failure.accessGone });
    // Worded on another screen, never on this one.
    expect(await create(refusal("spiel_outside_spieltag"))({ name: "Nord", plz: "60438" })).toStrictEqual({
      ok: false,
      errorCode: "spiel_outside_spieltag",
      reason: COPY.shared.failure.unexpected,
    });
    expect(state.steps.filter((step) => step === "updateTag site")).toStrictEqual([]);
    // The backend logs its own refusals.
    expect(state.lines).toStrictEqual([]);
  });

  it("answers any other throw as the unexpected failure, logging its name alone, and clears the tag", async () => {
    const answer = await create(new Error("lena@example.com was refused"))({ name: "Nord", plz: "60438" });

    expect(answer).toStrictEqual({ ok: false, reason: COPY.shared.failure.unexpected });
    expect(state.lines).toStrictEqual([{ level: "error", message: "action.failed", meta: { action: "anlegen", name: "Error" } }]);
    expect(state.steps.at(-1)).toBe("updateTag site");
  });

  it("hands Next's redirect on", async () => {
    await expect(create(catchRedirect())({ name: "Nord", plz: "60438" })).rejects.toHaveProperty(
      "digest",
      expect.stringContaining("NEXT_REDIRECT"),
    );
  });
});

/** The throw Next's `redirect` makes. */
function catchRedirect(): unknown {
  try {
    redirect("/area");
  } catch (thrown) {
    return thrown;
  }
}

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

  it("runs the body for a seat held at both halves of the address, handing it the seat", async () => {
    state.subject = seated({ team_id: "t2", saison_id: "2027" }, { team_id: "t1", saison_id: "2027" });

    expect(await register({ team_id: "t1", saison_id: "2027" })).toStrictEqual({ ok: true, value: undefined });
    expect(state.steps).toStrictEqual(["person guard", "body 1"]);
  });
});

describe("the passkey touch a lane declares", () => {
  const HOLDER = "inhaberin@example.org";
  const run = async () => {
    state.steps.push("body");
    return { ok: true as const, value: undefined };
  };
  const declared = { name: "passkeyAendern", input: Venue.extend(TOUCH_HOLDER), passkey: true } as const;
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

  it.each(["admin", "person"] as const)("runs the %s lane's act its touch passes for the address the page was drawn for", async (lane) => {
    expect(await touched(lane)({ name: "Nord", plz: "60438", holder: HOLDER.toUpperCase() })).toStrictEqual({ ok: true, value: undefined });
    expect(state.steps).toStrictEqual([lane === "admin" ? "admin guard" : "person guard", "passkey touch", "body"]);
  });

  /* The touch on a page whose own session ended signs in whichever account's passkey answers: the act would run as it. */
  it.each(["admin", "person"] as const)("refuses the %s lane's act a touch signed another account in for, running nothing", async (lane) => {
    expect(await touched(lane)({ name: "Nord", plz: "60438", holder: "jemand-anderes@example.org" })).toStrictEqual({
      ok: false,
      reason: COPY.shared.failure.signInExpired,
    });
    expect(state.steps).toStrictEqual([lane === "admin" ? "admin guard" : "person guard", "passkey touch"]);
  });

  it("asks no touch of an act that declares none", async () => {
    state.touch = false;

    expect(await action({ name: "anlegen", input: Venue, lane: "admin", run })({ name: "Nord", plz: "60438" })).toStrictEqual({
      ok: true,
      value: undefined,
    });
    expect(state.steps).toStrictEqual(["admin guard", "body"]);
  });
});

describe("the account's own acts", () => {
  const signOut = action({
    lane: "person",
    claim: "account",
    name: "abmelden",
    input: z.object({}),
    run: async (_input, { served }) => {
      state.steps.push(`body ${JSON.stringify(served)}`);
      return { ok: true, value: undefined };
    },
  });

  /* An address holding a grant signed in by its mailed code alone passes the person guard: its mailbox's holder
     would end the administrator's other sessions. */
  it("turns away a session the account's guard refuses, before the input is read", async () => {
    state.subject = person({});
    state.account = null;

    expect(await signOut({})).toStrictEqual({ ok: false, reason: COPY.shared.failure.signInExpired });
    expect(state.steps).toStrictEqual(["person guard", "account guard"]);
  });

  it("runs the body on the session the account's guard judged", async () => {
    state.subject = person({});
    state.account = { user: { id: "u1" } };

    expect(await signOut({})).toStrictEqual({ ok: true, value: undefined });
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

  it("parses the input once the check passed, the token no part of it", async () => {
    expect(await send({ email: "lena@example.com", "cf-turnstile-response": "token" } as { email: string })).toStrictEqual({
      ok: true,
      value: "lena@example.com",
    });
    expect(state.steps).toStrictEqual(["bot check token", "body"]);
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

  it("is not cleared for a write the backend refused", async () => {
    await onLane("public", () => sends("POST", undefined, refusal("link_invalid")))({ name: "Nord" });

    expect(cacheSteps()).toStrictEqual([]);
  });

  it("is cleared where one write landed before another was refused", async () => {
    await onLane("admin", async () => {
      await sends("POST");
      await sends("PATCH", undefined, refusal("version_stale"));
    })({ name: "Nord" });

    expect(cacheSteps()).toStrictEqual(["updateTag site"]);
  });

  it.each(["admin", "person", "public"] as const)(
    "stands on the %s lane when the body sent only reads, the page not rendered again",
    async (lane) => {
      await onLane(lane, async () => {
        await sends("GET");
        await sends("POST", true);
      })({ name: "Nord" });

      expect(cacheSteps()).toStrictEqual([]);
    },
  );

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

  it.each(["admin", "person", "public"] as const)(
    "is neither cleared nor the page rendered on the %s lane for an input the parse refuses",
    async (lane) => {
      expect(await onLane(lane, () => sends("POST"))({ name: "" })).toMatchObject({ ok: false });
      expect(cacheSteps()).toStrictEqual([]);
    },
  );
});
