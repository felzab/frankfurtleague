import { redirect } from "next/navigation";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { action } from "./action";
import { COPY } from "./copy";
import { APIBadStatusError } from "./errors";

import type { Code } from "./generated/client/types";

/** What each double answers, and what reached it. */
const stand = vi.hoisted(() => ({
  admin: { session: {} } as { session: object } | { refused: string },
  subject: null as object | null,
  seats: [] as { team_id: string; saison_id: string }[],
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
vi.mock("./funktionen", () => ({
  funktionenOf: () => ({ funktionen: stand.seats }),
  isSeatAt: (seat: { team_id: string; saison_id: string }, team: string, saison: string) => seat.team_id === team && seat.saison_id === saison,
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
function anlegen(wirft?: unknown) {
  return action({
    lane: "admin",
    name: "anlegen",
    input: Ort,
    ownWords: { "DB-COMMON-002": "name", "REQ-CLASH-001": true },
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
  stand.seats = [];
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

    expect(await anlegen()({ name: "Nord", plz: "60438" })).toStrictEqual({ ok: false, reason });
    expect(stand.steps).toStrictEqual(["admin guard"]);
  });

  it("strips every text as the backend does, parses it, runs the body and clears the site's tag", async () => {
    const posted = new FormData();
    posted.set("name", " Nord　");
    posted.set("plz", " 60438\n");

    expect(await anlegen()(posted)).toStrictEqual({ ok: true, value: undefined });
    expect(stand.steps).toStrictEqual(["admin guard", 'body {"name":"Nord","plz":"60438"}', "updateTag site"]);
  });

  it("keeps a character the backend's strip keeps", async () => {
    // U+FEFF is no White_Space, which JavaScript's `trim` would drop and Pydantic keeps.
    await anlegen()({ name: "﻿Nord", plz: "60438" });
    expect(stand.steps[1]).toBe(`body {"name":"﻿Nord","plz":"60438"}`);
  });

  it("places a value its schema refuses on its box in the German map's words, sending nothing", async () => {
    expect(await anlegen()({ name: "Sportpark Nordwest", plz: "6043" })).toStrictEqual({
      ok: false,
      fieldErrors: { name: COPY.shared.feld.hoechstensZeichen(10), plz: COPY.shared.feld.format(COPY.verwaltung.spielort.plzBeispiel) },
    });
    expect(stand.steps).toStrictEqual(["admin guard"]);
  });

  it("answers a code its screen words on the box it names, or as the status line's reason", async () => {
    expect(await anlegen(refusal("DB-COMMON-002"))({ name: "Nord", plz: "60438" })).toStrictEqual({
      ok: false,
      errorCode: "DB-COMMON-002",
      fieldErrors: { name: COPY.shared.ablehnung["DB-COMMON-002"] },
    });
    expect(await anlegen(refusal("REQ-CLASH-001"))({ name: "Nord", plz: "60438" })).toStrictEqual({
      ok: false,
      errorCode: "REQ-CLASH-001",
      reason: COPY.shared.ablehnung["REQ-CLASH-001"],
    });
  });

  it("answers every other code on the shared line its kind takes, and clears the tag behind each", async () => {
    expect(await anlegen(refusal("DB-COMMON-001"))({ name: "Nord", plz: "60438" })).toMatchObject({ reason: COPY.shared.fehler.veraltet });
    expect(await anlegen(refusal("REQ-AUTH-006"))({ name: "Nord", plz: "60438" })).toMatchObject({ reason: COPY.shared.fehler.zugangWeg });
    // Worded on another screen, never on this one.
    expect(await anlegen(refusal("REQ-DATE-001"))({ name: "Nord", plz: "60438" })).toStrictEqual({
      ok: false,
      errorCode: "REQ-DATE-001",
      reason: COPY.shared.fehler.unerwartet,
    });
    expect(stand.steps.filter((step) => step === "updateTag site")).toHaveLength(3);
    // The backend logs its own refusals.
    expect(stand.lines).toStrictEqual([]);
  });

  it("answers any other throw as the unexpected failure, logging its name alone, and clears the tag", async () => {
    const answer = await anlegen(new Error("lena@example.com was refused"))({ name: "Nord", plz: "60438" });

    expect(answer).toStrictEqual({ ok: false, reason: COPY.shared.fehler.unerwartet });
    expect(stand.lines).toStrictEqual([{ level: "error", message: "action.failed", meta: { action: "anlegen", name: "Error" } }]);
    expect(stand.steps.at(-1)).toBe("updateTag site");
  });

  it("hands Next's redirect on", async () => {
    await expect(anlegen(catchRedirect())({ name: "Nord", plz: "60438" })).rejects.toMatchObject({
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

const Sitz = z.object({ team_id: z.string(), saison_id: z.string() });

describe("the person lane", () => {
  const melden = action({
    lane: "person",
    claim: "seat",
    name: "melden",
    input: Sitz,
    run: async (_input, { seats }) => {
      stand.steps.push(`body ${String(seats.length)}`);
      return { ok: true, value: undefined };
    },
  });

  it("turns away a caller with no session, logging why, before the input is read", async () => {
    expect(await melden({ team_id: "t1", saison_id: "2027" })).toStrictEqual({ ok: false, reason: COPY.shared.fehler.abgelaufen });
    expect(stand.steps).toStrictEqual(["person guard"]);
    expect(stand.lines).toStrictEqual([
      { level: "info", message: "funktion.verweigert", meta: { operation: "melden", grund: "keine_sitzung" } },
    ]);
  });

  it("refuses a seat the person holds in another season, naming nothing of the address", async () => {
    stand.subject = { email: "lena@example.com" };
    stand.seats = [{ team_id: "t1", saison_id: "2026" }];

    expect(await melden({ team_id: "t1", saison_id: "2027" })).toStrictEqual({ ok: false, reason: COPY.shared.fehler.veraltet });
    expect(stand.steps).toStrictEqual(["person guard"]);
    expect(JSON.stringify(stand.lines)).not.toContain("@");
  });

  it("runs the body for a seat held at both halves of the address, handing it the seat", async () => {
    stand.subject = { email: "lena@example.com" };
    stand.seats = [{ team_id: "t1", saison_id: "2027" }];

    expect(await melden({ team_id: "t1", saison_id: "2027" })).toStrictEqual({ ok: true, value: undefined });
    expect(stand.steps).toStrictEqual(["person guard", "body 1", "updateTag site"]);
  });
});

describe("the public lane", () => {
  const senden = action({
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

    expect(await senden(posted)).toStrictEqual({ ok: false, reason: COPY.shared.pruefung.bestaetigen });
    expect(stand.steps).toStrictEqual(["bot check token"]);
  });

  it("parses the input once the check passed, the token no part of it", async () => {
    expect(await senden({ email: "lena@example.com", "cf-turnstile-response": "token" } as { email: string })).toStrictEqual({
      ok: true,
      value: "lena@example.com",
    });
    expect(stand.steps).toStrictEqual(["bot check token", "body", "updateTag site"]);
  });
});
