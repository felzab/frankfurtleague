import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { doubleApiClient } from "@/shared/testing/apiClientDouble.ts";

import type { ApiCall } from "@/shared/testing/apiClientDouble.ts";

/* What these cases read is what each mutation asks the client for, never what it answers. */
const sent = doubleApiClient(() => ({ acknowledged: 1 }));

const { ablehnenBewerbung, annehmenBewerbung, besetzenKontaktSitz, erneutSendenEinwilligung, korrigierenKontaktEmail } =
  await import("./mutations.ts");

const ID = "68c1f0a2b3c4d5e6f7a8b9c0";

/** The one request the last mutation sent, its body parsed. */
function lastSent(): { endpoint: string; method: string | undefined; body: unknown } {
  assert.equal(sent.length, 1, `the mutation sent ${String(sent.length)} requests rather than one`);
  const [{ endpoint, method, body }] = sent as [ApiCall];

  return { endpoint, method, body: body === undefined ? undefined : JSON.parse(body) };
}

beforeEach(() => {
  sent.length = 0;
});

/* The id is split off into the path by both decisions; a body carrying one is refused whole, the
   backend payloads forbidding an extra field. */
describe("how each triage endpoint is addressed", () => {
  it("posts the acceptance to its own endpoint, the id in the path and out of the body", async () => {
    await annehmenBewerbung({ id: ID, gruppe: "A", trikot_farbe: null });

    assert.deepEqual(lastSent(), { endpoint: `/bewerbungen/${ID}/annehmen`, method: "POST", body: { gruppe: "A", trikot_farbe: null } });
  });

  it("posts the decline to its own endpoint, the id in the path and out of the body", async () => {
    await ablehnenBewerbung({ id: ID, grund: "Die Liga ist voll." });

    assert.deepEqual(lastSent(), { endpoint: `/bewerbungen/${ID}/ablehnen`, method: "POST", body: { grund: "Die Liga ist voll." } });
  });
});

describe("how each contact repair is addressed", () => {
  it("posts the re-send with the seat in the path and no body", async () => {
    await erneutSendenEinwilligung({ id: ID, rolle: "trainer" });

    assert.deepEqual(lastSent(), { endpoint: `/bewerbungen/${ID}/einwilligung/trainer/erneut`, method: "POST", body: undefined });
  });

  it("posts the correction with the seat in the path and the address alone in the body", async () => {
    await korrigierenKontaktEmail({ id: ID, rolle: "ansprechperson", email: "anna.neu@example.de" });

    assert.deepEqual(lastSent(), {
      endpoint: `/bewerbungen/${ID}/kontakte/ansprechperson/email`,
      method: "POST",
      body: { email: "anna.neu@example.de" },
    });
  });

  /* The correction's own path with the `/email` segment dropped, and it takes a body: everything but
     the application and the seat is typed, so a path-only request would seat nobody. */
  it("posts the reseat with the seat in the path and the person in the body", async () => {
    const person = {
      vorname: "Berta",
      nachname: "Beispiel",
      email: "berta@example.de",
      telefon: "069 1234567",
      text_version: "2026-08-01",
    };

    await besetzenKontaktSitz({ id: ID, rolle: "stellvertretung", ...person });

    assert.deepEqual(lastSent(), { endpoint: `/bewerbungen/${ID}/kontakte/stellvertretung`, method: "POST", body: person });
  });
});
