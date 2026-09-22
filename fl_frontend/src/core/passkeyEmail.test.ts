import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { buildPasskeyGeloeschtEmail, buildPasskeyHinzugefuegtEmail } = await import("./passkeyEmail.ts");

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";

/* Winter, so the instant is an hour off UTC rather than two: a formatter that ignored the zone
   would answer the same string in summer and this case would then prove nothing. */
const ZEITPUNKT = new Date("2026-01-15T22:30:00Z");

const BEIDE = [
  { name: "buildPasskeyHinzugefuegtEmail", mail: buildPasskeyHinzugefuegtEmail({ zeitpunkt: ZEITPUNKT, origin: ORIGIN }) },
  { name: "buildPasskeyGeloeschtEmail", mail: buildPasskeyGeloeschtEmail({ zeitpunkt: ZEITPUNKT, origin: ORIGIN }) },
];

describe("the notice each passkey change sends", () => {
  /* The image runs UTC and the reader does not. Without the zone the message would date a change
     made at half past eleven in the evening to the day before, which is what a reader checks it by. */
  it("stamps both messages in the reader's own zone, in both branches", () => {
    for (const { name, mail } of BEIDE) {
      assert.ok(mail.html.includes("23:30"), `${name} dates its event in the server's zone`);
      assert.ok(mail.text.includes("23:30"), `${name}'s text branch dates its event in the server's zone`);
      assert.ok(mail.text.includes("15. Januar 2026"), `${name} does not name the day in German`);
    }
  });

  /* Two separate builders, because one message reporting either event would have to word both in a
     sentence that names neither: a reader acts on the notice or does not. */
  it("tells the two events apart, and says in the removal that the other devices went with it", () => {
    assert.ok(BEIDE[0]?.mail.subject !== BEIDE[1]?.mail.subject, "both events arrive under one subject");
    assert.ok(BEIDE[0]?.mail.text.includes("hinzugefügt"), "the addition does not name what happened");
    assert.ok(BEIDE[1]?.mail.text.includes("abgemeldet"), "the removal does not say the other devices were signed out");
  });

  /* The reader has to be able to act, and the notice is the only place they learn of an enrolment
     somebody else made. One control, at the surface where a passkey can be taken away again. */
  it("offers the administrator's own surface and no other destination", () => {
    for (const { name, mail } of BEIDE) {
      assert.ok(mail.html.includes(`href="${ORIGIN}/admin"`), `${name} does not link the administration`);
      assert.ok(mail.text.includes(`${ORIGIN}/admin`), `${name}'s text branch offers no way back`);
      assert.ok(mail.html.includes("melde Dich sofort bei uns"), `${name} says nothing about a change the reader did not make`);
    }
  });

  /* A builder takes an instant and an origin, so no row material can reach a message from here. The
     two SENDS are held to it instead, each looking for the real row's values in what was sent. */
});
