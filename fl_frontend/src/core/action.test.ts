import { redirect } from "next/navigation";

import { bodyField, refusedPayload } from "@/test-support/refusedPayload.ts";
import { person, seat } from "@/test-support/subjectFixtures.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { action } from "./action";
import { COPY } from "./copy";
import { APIBadStatusError } from "./errors";
import { SERVER_COPY } from "./serverCopy";

import type { Code } from "./generated/client/types";
import type { SubjectSession } from "./subject";

/** What each double answers, and what reached it. */
const stand = vi.hoisted(() => ({
  admin: { session: {} } as { session: object } | { refused: string },
  subject: null as SubjectSession | null,
  botCheck: null as string | null,
  /** Every step in the order it ran. */
  steps: [] as string[],
  lines: [] as { level: string; message: string; meta: unknown }[],
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ updateTag: (tag: string) => stand.steps.push(`updateTag ${tag}`) }));
vi.mock("./auth", () => ({
  judgeAdminRequest: async () => {
    stand.steps.push("admin guard");
    return stand.admin;
  },
}));
vi.mock("./subject", () => ({
  getSubjectSession: async () => {
    stand.steps.push("person guard");
    return stand.subject;
  },
}));
vi.mock("./turnstile", () => ({
  turnstileRefusal: async (token: string | null) => {
    stand.steps.push(`bot check ${String(token)}`);
    return stand.botCheck;
  },
}));
vi.mock("./logging", () => ({
  logger: {
    info: (message: string, meta: unknown) => stand.lines.push({ level: "info", message, meta }),
    error: (message: string, _error: unknown, meta: unknown) => stand.lines.push({ level: "error", message, meta }),
  },
}));

const Ort = z.object({ name: z.string().min(1).max(10), plz: z.string().regex(/^\d{5}$/) });

const refusal = (code: Code) =>
  new APIBadStatusError({
    message: "refused",
    url: "http://backend/api/v0/spielorte",
    statusCode: 409,
    serverErrorCode: code,
    endpoint: "/spielorte",
    method: "POST",
    readOnly: false,
    traceId: "0",
  });

/** An admin create whose body records what it was handed, or throws `wirft`. */
function create(wirft?: unknown) {
  return action({
    lane: "admin",
    name: "anlegen",
    input: Ort,
    ownWords: { duplicate_key: "name", spiel_double_booked: true },
    examples: { plz: COPY.verwaltung.spielort.plzBeispiel },
    run: async (input) => {
      stand.steps.push(`body ${JSON.stringify(input)}`);
      if (wirft !== undefined) throw wirft;
      return { ok: true, value: undefined };
    },
  });
}

beforeEach(() => {
  stand.admin = { session: {} };
  stand.subject = null;
  stand.botCheck = null;
  stand.steps = [];
  stand.lines = [];
});

describe("the admin lane", () => {
  it.each([
    ["signIn", COPY.shared.fehler.abgelaufen],
    ["noGrant", COPY.shared.fehler.zugangWeg],
    ["grantGone", COPY.shared.fehler.zugangWeg],
    ["unread", COPY.shared.fehler.zugangUngeprueft],
  ])("turns a caller the guard refuses as %s away in the words of its repair, before anything else", async (refused, reason) => {
    stand.admin = { refused };

    expect(await create()({ name: "Nord", plz: "60438" })).toStrictEqual({ ok: false, reason });
    expect(stand.steps).toStrictEqual(["admin guard"]);
  });

  it("strips every text as the backend does, parses it, runs the body and clears the site's tag", async () => {
    const posted = new FormData();
    posted.set("name", "\u00a0Nord\u3000");
    // U+001F is no White_Space, which Python's `str.strip` drops all the same.
    posted.set("plz", " 60438\u001f");

    expect(await create()(posted)).toStrictEqual({ ok: true, value: undefined });
    expect(stand.steps).toStrictEqual(["admin guard", 'body {"name":"Nord","plz":"60438"}', "updateTag site"]);
  });

  it("keeps a character the backend's strip keeps", async () => {
    // U+FEFF is no White_Space, which JavaScript's `trim` would drop and Python's `str.strip` keeps.
    await create()({ name: "\ufeffNord", plz: "60438" });
    expect(stand.steps[1]).toBe(`body {"name":"\ufeffNord","plz":"60438"}`);
  });

  it("places a value its schema refuses on its box in the German map's words, sending nothing", async () => {
    expect(await create()({ name: "Sportpark Nordwest", plz: "6043" })).toStrictEqual({
      ok: false,
      fieldErrors: { name: COPY.shared.feld.hoechstensZeichen(10), plz: COPY.shared.feld.format(COPY.verwaltung.spielort.plzBeispiel) },
    });
    expect(stand.steps).toStrictEqual(["admin guard"]);
  });

  it("keeps two boxes apart whose paths end in one name, keying each by its whole path", async () => {
    const Seite = z.object({ tore: z.number().min(0).max(99) });
    const ergebnis = (wirft?: unknown) =>
      action({
        lane: "admin",
        name: "ergebnis",
        input: z.object({ team1: Seite, team2: Seite }),
        ownWords: { state_ergebnis_on_a_non_event: "team2.tore" },
        run: async () => {
          if (wirft !== undefined) throw wirft;
          return { ok: true, value: undefined };
        },
      });

    expect(await ergebnis()({ team1: { tore: -1 }, team2: { tore: 100 } })).toStrictEqual({
      ok: false,
      fieldErrors: { "team1.tore": COPY.shared.feld.zwischen(0, 99), "team2.tore": COPY.shared.feld.zwischen(0, 99) },
    });
    expect(await ergebnis(refusal("state_ergebnis_on_a_non_event"))({ team1: { tore: 1 }, team2: { tore: 2 } })).toStrictEqual({
      ok: false,
      errorCode: "state_ergebnis_on_a_non_event",
      fieldErrors: { "team2.tore": SERVER_COPY.ablehnung["state_ergebnis_on_a_non_event"] },
    });
  });

  it("answers a code its screen words on the box it names, or as the status line's reason", async () => {
    expect(await create(refusal("duplicate_key"))({ name: "Nord", plz: "60438" })).toStrictEqual({
      ok: false,
      errorCode: "duplicate_key",
      fieldErrors: { name: SERVER_COPY.ablehnung["duplicate_key"] },
    });
    expect(await create(refusal("spiel_double_booked"))({ name: "Nord", plz: "60438" })).toStrictEqual({
      ok: false,
      errorCode: "spiel_double_booked",
      reason: SERVER_COPY.ablehnung["spiel_double_booked"],
    });
  });

  it("places each rule a refused payload broke where its screen words it, and answers the stale line where it does not", async () => {
    const kontakte = (wirft: unknown) =>
      action({
        lane: "admin",
        name: "kontakte",
        input: z.object({ kontakte: z.array(z.object({ email: z.string() })), datum: z.string() }),
        ownWords: { kontakt_email_twice: "kontakte", date_not_in_calendar: "datum", gute_spieler_exceed_kader: true },
        run: async () => {
          throw wirft;
        },
      });
    const input = { kontakte: [{ email: "lena@example.com" }], datum: "2027-02-30" };

    // A rule over several fields reports the block holding them, here the whole payload: the screen names its box.
    const twoRules = refusedPayload([bodyField([], "kontakt_email_twice"), bodyField(["datum"], "date_not_in_calendar")]);
    expect(await kontakte(twoRules)(input)).toStrictEqual({
      ok: false,
      errorCode: "payload_refused",
      fieldErrors: { kontakte: SERVER_COPY.regel.kontakt_email_twice, datum: SERVER_COPY.regel.date_not_in_calendar },
    });
    expect(await kontakte(refusedPayload([bodyField([], "gute_spieler_exceed_kader")]))(input)).toStrictEqual({
      ok: false,
      errorCode: "payload_refused",
      reason: SERVER_COPY.regel.gute_spieler_exceed_kader,
    });
    // One rule the screen does not word, a published bound among them: the page is older than the API.
    for (const kind of ["kontakt_telefon_twice", "string_too_long"]) {
      expect(await kontakte(refusedPayload([bodyField([], "kontakt_email_twice"), bodyField(["datum"], kind)]))(input), kind).toStrictEqual({
        ok: false,
        errorCode: "payload_refused",
        reason: COPY.shared.fehler.veraltet,
      });
    }
  });

  it("answers every other code on the shared line its kind takes, and clears the tag behind each", async () => {
    expect(await create(refusal("document_not_found"))({ name: "Nord", plz: "60438" })).toMatchObject({ reason: COPY.shared.fehler.veraltet });
    expect(await create(refusal("actor_not_admin"))({ name: "Nord", plz: "60438" })).toMatchObject({ reason: COPY.shared.fehler.zugangWeg });
    // Worded on another screen, never on this one.
    expect(await create(refusal("spiel_outside_spieltag"))({ name: "Nord", plz: "60438" })).toStrictEqual({
      ok: false,
      errorCode: "spiel_outside_spieltag",
      reason: COPY.shared.fehler.unerwartet,
    });
    expect(stand.steps.filter((step) => step === "updateTag site")).toHaveLength(3);
    // The backend logs its own refusals.
    expect(stand.lines).toStrictEqual([]);
  });

  it("answers any other throw as the unexpected failure, logging its name alone, and clears the tag", async () => {
    const answer = await create(new Error("lena@example.com was refused"))({ name: "Nord", plz: "60438" });

    expect(answer).toStrictEqual({ ok: false, reason: COPY.shared.fehler.unerwartet });
    expect(stand.lines).toStrictEqual([{ level: "error", message: "action.failed", meta: { action: "anlegen", name: "Error" } }]);
    expect(stand.steps.at(-1)).toBe("updateTag site");
  });

  it("hands Next's redirect on", async () => {
    await expect(create(catchRedirect())({ name: "Nord", plz: "60438" })).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
  });
});

/** The throw Next's `redirect` makes. */
function catchRedirect(): unknown {
  try {
    redirect("/bereich");
  } catch (thrown) {
    return thrown;
  }
}

const Seat = z.object({ team_id: z.string().min(1), saison_id: z.string().min(1) });

/** A signed-in person holding a contact seat at each team and season named, in seasons that grant a panel. */
const sitzend = (...sitze: { team_id: string; saison_id: string }[]) => person({ sitze: sitze.map((at) => seat(at)) });

describe("the person lane", () => {
  const melden = action({
    lane: "person",
    claim: "seat",
    name: "melden",
    input: Seat,
    run: async (_input, { seats }) => {
      stand.steps.push(`body ${String(seats.length)}`);
      return { ok: true, value: undefined };
    },
  });

  it("turns away a caller with no session, logging why, before the input is read", async () => {
    // An input the schema refuses: read first, it would answer with the box's message.
    expect(await melden({ team_id: "", saison_id: "2027" })).toStrictEqual({ ok: false, reason: COPY.shared.fehler.abgelaufen });
    expect(stand.steps).toStrictEqual(["person guard"]);
    expect(stand.lines).toStrictEqual([
      { level: "info", message: "funktion.verweigert", meta: { operation: "melden", grund: "keine_sitzung" } },
    ]);
  });

  it.each([
    ["in another season", { team_id: "t1", saison_id: "2026" }],
    ["at another team in the same season", { team_id: "t2", saison_id: "2027" }],
  ])("refuses a seat the person holds %s, naming nothing of the address", async (_where, held) => {
    stand.subject = sitzend(held);

    expect(await melden({ team_id: "t1", saison_id: "2027" })).toStrictEqual({ ok: false, reason: COPY.shared.fehler.veraltet });
    expect(stand.steps).toStrictEqual(["person guard"]);
    expect(JSON.stringify(stand.lines)).not.toContain("@");
  });

  it("runs the body for a seat held at both halves of the address, handing it the seat", async () => {
    stand.subject = sitzend({ team_id: "t2", saison_id: "2027" }, { team_id: "t1", saison_id: "2027" });

    expect(await melden({ team_id: "t1", saison_id: "2027" })).toStrictEqual({ ok: true, value: undefined });
    expect(stand.steps).toStrictEqual(["person guard", "body 1", "updateTag site"]);
  });
});

describe("the public lane", () => {
  const send = action({
    lane: "public",
    botCheck: true,
    name: "senden",
    input: z.object({ email: z.email() }),
    run: async ({ email }) => {
      stand.steps.push("body");
      return { ok: true, value: email };
    },
  });

  it("answers the bot check's refusal before anything of the input is read", async () => {
    stand.botCheck = COPY.shared.pruefung.bestaetigen;
    const posted = new FormData();
    posted.set("email", "keine-adresse");
    posted.set("cf-turnstile-response", "token");

    expect(await send(posted)).toStrictEqual({ ok: false, reason: COPY.shared.pruefung.bestaetigen });
    expect(stand.steps).toStrictEqual(["bot check token"]);
  });

  it("parses the input once the check passed, the token no part of it", async () => {
    expect(await send({ email: "lena@example.com", "cf-turnstile-response": "token" } as { email: string })).toStrictEqual({
      ok: true,
      value: "lena@example.com",
    });
    // A public write reaches no cached read, so the site's tag stands.
    expect(stand.steps).toStrictEqual(["bot check token", "body"]);
  });
});
