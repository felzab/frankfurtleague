import { doubleApiClient, requestsOf } from "@/test-support/apiClientDouble.ts";
import { assert, beforeEach, describe, expect, it } from "vitest";

import type { SentApiRequest } from "@/test-support/apiClientDouble.ts";

/* What these cases read is what each mutation asks the client for, never what it answers. */
const sent = doubleApiClient(() => ({}));

const { ablehnenBewerbung, annehmenBewerbung, besetzenKontaktSitz, erneutSendenEinwilligung } = await import("./mutations.ts");

const ID = "68c1f0a2b3c4d5e6f7a8b9c0";

/** The one request the last mutation sent. */
function lastSent(): SentApiRequest {
  const [only, ...more] = requestsOf(sent);
  assert.ok(only !== undefined && more.length === 0, `the mutation sent ${String(sent.length)} requests rather than one`);

  return only;
}

beforeEach(() => {
  sent.length = 0;
});

/* The id is split off into the path by both decisions; a body carrying one is refused whole, the
   backend payloads forbidding an extra field. */
describe("how each triage endpoint is addressed", () => {
  it("posts the acceptance to its own endpoint, the id in the path and out of the body", async () => {
    await annehmenBewerbung({ id: ID, gruppe: "A", trikot_farbe: null, shorthand: null, version: 0 });

    expect(lastSent()).toStrictEqual({
      endpoint: `/bewerbungen/${ID}/accept`,
      method: "POST",
      body: { gruppe: "A", trikot_farbe: null, shorthand: null, version: 0 },
    });
  });

  it("posts the decline to its own endpoint, the id in the path and out of the body", async () => {
    await ablehnenBewerbung({ id: ID, reason: "Die Liga ist voll.", version: 0 });

    expect(lastSent()).toStrictEqual({
      endpoint: `/bewerbungen/${ID}/decline`,
      method: "POST",
      body: { reason: "Die Liga ist voll.", version: 0 },
    });
  });
});

describe("how each contact repair is addressed", () => {
  it("posts the re-send with the seat in the path and no body", async () => {
    await erneutSendenEinwilligung({ id: ID, rolle: "trainer" });

    expect(lastSent()).toStrictEqual({ endpoint: `/bewerbungen/${ID}/einwilligung/trainer/resend`, method: "POST", body: undefined });
  });

  /* Everything but the application and the seat is typed, so a path-only request would seat nobody. */
  it("posts the reseat with the seat in the path and the person in the body", async () => {
    const person = {
      first_name: "Berta",
      last_name: "Beispiel",
      email: "berta@example.de",
      phone: "069 1234567",
      version: 0,
    };

    await besetzenKontaktSitz({ id: ID, rolle: "stellvertretung", ...person });

    expect(lastSent()).toStrictEqual({ endpoint: `/bewerbungen/${ID}/kontakte/stellvertretung`, method: "POST", body: person });
  });
});
