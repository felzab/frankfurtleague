import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertRedactedAtTheEdge } from "./edgeRedaction.ts";
import { registerDoubles } from "./exportingModule.ts";
import { flat, readable } from "./mailText.ts";

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";

registerDoubles();

const { buildLoeschungEmail, LOESCHUNG_LINK_GUELTIG_STUNDEN, loeschungsLink } = await import("./loeschungEmail.ts");

const TOKEN = "kein-echtes-token";

describe("the deletion link this message spells", () => {
  it("puts the token on the origin it was handed, under the interstitial's path", () => {
    assert.equal(loeschungsLink(ORIGIN, TOKEN), `${ORIGIN}/loeschung?token=${TOKEN}`);
  });

  /* Each minter pins its own spelling against the edge's map, which enumerates none of them. */
  it("names a parameter the edge's own redaction map replaces", () => {
    assertRedactedAtTheEdge(loeschungsLink(ORIGIN, TOKEN));
  });

  /* The origin is normalised inside the builder, which keeps a trailing slash on `AUTH_URL` out of the link. */
  it("normalises the origin before the link is spelled, not after", () => {
    const gebaut = buildLoeschungEmail({ origin: `${ORIGIN}/`, token: TOKEN });

    assert.ok(gebaut.html.includes(`${ORIGIN}/loeschung?token=`), "a configured trailing slash reaches the link");
  });
});

describe("the message a person asking to delete their account is mailed", () => {
  const mail = buildLoeschungEmail({ origin: ORIGIN, token: TOKEN });

  it("carries the live link in both branches", () => {
    const url = loeschungsLink(ORIGIN, TOKEN);

    assert.ok(mail.html.includes(url), "the markup branch carries no link");
    assert.ok(mail.text.includes(url), "the text branch carries no link");
  });

  /* Both branches state the same facts: what goes, that nothing brings it back, how long the link holds, and
     that it completes only signed in, which a reader opening it on another device needs before the press. */
  it("says what goes, that it cannot be undone, how long the link holds and where to open it, in both branches", () => {
    for (const [branch, words] of [
      ["html", readable(mail.html)],
      ["text", flat(mail.text)],
    ] as const) {
      assert.match(words, /löschen wir Dein Konto und alle Angaben/, `the ${branch} branch does not say what goes`);
      assert.match(words, /Zurückholen lässt sich das nicht\./, `the ${branch} branch does not say it cannot be undone`);
      assert.ok(words.includes(`Der Link gilt ${String(LOESCHUNG_LINK_GUELTIG_STUNDEN)} Stunden.`), `the ${branch} branch names no validity`);
      assert.match(words, /in dem Du angemeldet bist/, `the ${branch} branch does not say the link needs a session`);
      assert.match(words, /Warst Du das nicht\?/, `the ${branch} branch says nothing about a request the reader did not make`);
    }
  });
});
