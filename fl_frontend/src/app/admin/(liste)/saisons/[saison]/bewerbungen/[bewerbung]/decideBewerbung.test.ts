import { doubleApiClient } from "@/test-support/apiClientDouble";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { APIBadStatusError } from "@/core/errors";
import { SERVER_COPY } from "@/core/serverCopy";

import type { Code } from "@/core/generated/client/types";

const ID = "64b000000000000000000002";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));

/** What the doubled client throws next, `null` for an accepted write. */
const state = vi.hoisted(() => ({ refusal: null as unknown, sent: [] as unknown[] }));

doubleApiClient((call) => {
  state.sent.push({ endpoint: call.endpoint, body: JSON.parse(call.body ?? "null") as unknown });
  if (state.refusal !== null) throw state.refusal;
  return { email: "stored@example.de" };
});

const { acceptBewerbung } = await import("./decideBewerbung");
const { sendSeatLink, writeSeat } = await import("./writeSeat");

/** The refusal the client raises, naming the box its code words. */
const refusal = (serverErrorCode: Code, path: readonly string[] = []) =>
  new APIBadStatusError({
    message: "refused",
    url: "http://backend/api/v0/",
    statusCode: 409,
    serverErrorCode,
    endpoint: "/",
    method: "POST",
    readOnly: false,
    traceId: "0",
    refusedFields: path.length === 0 ? [] : [{ path: [...path], kind: serverErrorCode, ctx: {}, in: "body" }],
  });

/** An acceptance as the dialog posts it: a closed box posts nothing at all. */
function posted(fields: Readonly<Record<string, string>>): FormData {
  const form = new FormData();
  form.set("id", ID);
  form.set("version", "3");
  form.set("gruppe", "A");
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

beforeEach(() => {
  state.refusal = null;
  state.sent = [];
});

describe("an acceptance", () => {
  /* A known club's closed box posts nothing: read as a missing field, every known club's acceptance would fail on a box
     nobody can touch, and the write refuses a code sent for one. */
  it("sends no code for a known club and the wish's blank as no colour", async () => {
    await acceptBewerbung(posted({ trikot_farbe: "" }));

    expect(state.sent).toStrictEqual([
      { endpoint: `/bewerbungen/${ID}/accept`, body: { gruppe: "A", trikot_farbe: null, shorthand: null, version: 3 } },
    ]);
  });
});

describe("a seat's write", () => {
  const person = {
    id: ID,
    seat: "trainer",
    first_name: "Anke",
    last_name: "Koerner",
    email: "a@example.de",
    phone: "069 90009123",
    version: 3,
  };

  it("says the address the write stored, the seat in the path and out of the body", async () => {
    const answer = await writeSeat(person);

    expect(state.sent).toMatchObject([{ endpoint: `/bewerbungen/${ID}/kontakte/trainer`, body: { first_name: "Anke", version: 3 } }]);
    expect(answer).toMatchObject({ ok: true, note: COPY.admin.schiedsrichter.sentTo("stored@example.de") });
  });

  it.each([
    ["bewerbung_kontakt_email_taken", "email"],
    ["bewerbung_kontakt_phone_taken", "phone"],
  ] as const)("answers %s on its box", async (code, box) => {
    state.refusal = refusal(code, [box]);

    expect(await writeSeat(person)).toMatchObject({ ok: false, fieldErrors: { [box]: COPY.shared.field.taken } });
  });
});

describe("a seat's fresh link", () => {
  /* The ban came after the application, which the page cannot know: the shared failure line sends the administrator to
     a retry the same rule refuses again. */
  it("says the ban list's own sentence", async () => {
    state.refusal = refusal("bewerbung_kontakt_barred");

    expect(await sendSeatLink({ bewerbung_id: ID, seat: "trainer" })).toMatchObject({
      ok: false,
      reason: SERVER_COPY.refusalLine.bewerbung_kontakt_barred,
    });
  });
});
