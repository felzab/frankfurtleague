import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { registerDoubles } from "./exportingModule.ts";
import { flat, readable } from "./mailText.ts";

registerDoubles();

const { buildCodeEmail, CODE_VALIDITY_MINUTES } = await import("./authEmail.ts");
const { KONTAKT_EMAIL, VEREIN_ANSCHRIFT, VEREIN_NAME } = await import("./brand.ts");

/** Derived, so what this file reads for is the sentence rather than a second copy of the figure. */
const GUELTIGKEIT = `${String(CODE_VALIDITY_MINUTES)} Minuten`;

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";

const CODE = "048213";

/** The one interpolated value, carrying every character `escapeHtml` covers: the builder takes a string. */
const HOSTILE_CODE = `a"<script>&b='c'`;

const FUSS_SATZ = `Antworten an die Absenderadresse liest niemand; unsere Adresse ist ${KONTAKT_EMAIL}.`;
const NUR_HIER_SATZ = "Gib ihn nur auf localhost:3000 ein. Wir fragen Dich nie auf anderem Weg nach diesem Code.";
const IGNORIER_SATZ = "Du hast keinen Code angefordert? Dann ignoriere diese E-Mail einfach. Ohne den Code passiert nichts.";

/** The shell's close as this branch ends on it: the block a folded delimiter line would swallow whole. */
const TEXT_SCHLUSS = [
  "-- ",
  FUSS_SATZ,
  `Datenschutzerklärung: ${ORIGIN}/datenschutz`,
  `Impressum: ${ORIGIN}/impressum`,
  `${VEREIN_NAME}, ${VEREIN_ANSCHRIFT}`,
].join("\n");

describe("how long the mailed code stays good for", () => {
  /* The literal, because every other case here derives its expectation from the constant and so
     passes at any figure. A code is a bearer credential in an inbox, and this is what bounds it. */
  it("is ten minutes", () => {
    assert.equal(CODE_VALIDITY_MINUTES, 10);
  });
});

describe("buildCodeEmail", () => {
  /* A mail client renders one branch or the other, so a fact only one half carried would reach only
     half the readers -- and here that fact is the code the message exists to deliver. */
  it("states the same facts in both branches", () => {
    const mail = buildCodeEmail(CODE, ORIGIN);

    for (const fakt of [
      CODE,
      "Dein Anmeldecode",
      // The approved words: the account page's confirmation sends this mail as the sign-in page does.
      "Gib diesen Code auf der Seite ein, auf der Du ihn angefordert hast:",
      `Er ist ${GUELTIGKEIT} gültig und kann nur einmal verwendet werden.`,
      NUR_HIER_SATZ,
      IGNORIER_SATZ,
    ]) {
      assert.ok(flat(readable(mail.html)).includes(fakt), `the HTML branch lost „${fakt}“`);
      assert.ok(flat(mail.text).includes(fakt), `the text branch lost „${fakt}“`);
    }
    assert.equal(mail.subject, "Dein Anmeldecode für die Frankfurt League");
  });

  /* The approved sentence, as the published origin renders it: the host is the origin's and never a
     literal of this module, so the local stack's message above names its own. */
  it("tells a reader of the published origin to type the code on frankfurtleague.de alone", () => {
    const mail = buildCodeEmail(CODE, "https://frankfurtleague.de");
    const satz = "Gib ihn nur auf frankfurtleague.de ein. Wir fragen Dich nie auf anderem Weg nach diesem Code.";

    assert.ok(flat(readable(mail.html)).includes(satz), "the HTML branch names another place");
    assert.ok(flat(mail.text).includes(satz), "the text branch names another place");
  });

  /* A copy to paste from a phone, so the code has a line to itself in the plain branch: run into a
     sentence, a client's own code detection and a reader's selection both take the punctuation. */
  it("sets the code on a line of its own in the text branch", () => {
    const mail = buildCodeEmail(CODE, ORIGIN);

    assert.ok(mail.text.split("\n").includes(CODE));
  });

  it("escapes the code it is handed", () => {
    const mail = buildCodeEmail(HOSTILE_CODE, ORIGIN);

    assert.ok(!mail.html.includes("<script>"), "an unescaped tag reached the markup");
    assert.ok(readable(mail.html).includes(HOSTILE_CODE), "escaping changed the code rather than its encoding");
  });

  /* The design's whole reason for a code: a link spends itself for whoever opens a forwarded message,
     and one without the code opens a second sign-in page holding none of the reader's step. */
  it("offers no control and links nothing but the close's own pages", () => {
    const mail = buildCodeEmail(CODE, ORIGIN);
    const body = mail.html.slice(0, mail.html.indexOf("<hr"));

    assert.ok(!body.includes("<a "), "the body carries a link");
    assert.equal([...mail.html.matchAll(/<hr\b/g)].length, 1, "an empty control row was drawn between two rules");
  });

  /* Where the note stands decides whether the reader it exists for reaches it: last in the body, above
     the rule, and never down in the grey close -- as it stands in the application messages. */
  it("places the note for a reader who requested nothing last in the body", () => {
    const mail = buildCodeEmail(CODE, ORIGIN);
    const auf = mail.html.lastIndexOf("<p ", mail.html.indexOf(IGNORIER_SATZ));
    const grade = mail.html.slice(auf, mail.html.indexOf(">", auf));

    assert.ok(mail.html.indexOf(IGNORIER_SATZ) < mail.html.indexOf("<hr"), "the note fell below the rule");
    assert.ok(grade.includes("font-size:13px"), "the note is not set in the aside grade");
    assert.ok(readable(mail.html.slice(mail.html.lastIndexOf("<hr"))).includes(FUSS_SATZ), "the close no longer says replies are unread");
  });

  it("closes the text branch with RFC 3676's signature delimiter", () => {
    const mail = buildCodeEmail(CODE, ORIGIN);

    assert.ok(mail.text.includes("\n-- \n"), "without the trailing space no client folds the footer");
    assert.ok(mail.text.endsWith(`\n${TEXT_SCHLUSS}`), "the text branch no longer closes on its footer");
    assert.ok(mail.text.indexOf(IGNORIER_SATZ) < mail.text.indexOf("\n-- \n"), "the note fell below the signature delimiter");
  });
});
