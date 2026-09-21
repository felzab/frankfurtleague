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

const { buildMagicLinkEmail, LINK_VALIDITY_MINUTES } = await import("./authEmail.ts");
const { KONTAKT_EMAIL, VEREIN_ANSCHRIFT, VEREIN_NAME } = await import("./brand.ts");

/** Derived, so what this file reads for is the sentence rather than a second copy of the figure. */
const GUELTIGKEIT = `${String(LINK_VALIDITY_MINUTES)} Minuten`;

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";

/** The markup branch reduced to the facts a reader ends up with, so a fact is checked as a fact in both branches. */
function readable(html: string): string {
  let stripped = html;

  // To a FIXPOINT: a pattern leaving a tag standing hands the caller markup to read as text
  // (`fl_frontend/src/shared/testing/renderTest.ts :: textOf`).
  for (let previous = ""; stripped !== previous;) {
    previous = stripped;
    stripped = stripped.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, " ");
  }

  return (
    stripped
      // Below the strip and never inside it: `&lt;script&gt;` decodes to a tag this file asserts a
      // reader is served, and a strip running after would eat it.
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'")
      .replaceAll("&amp;", "&")
      .replace(/\s+/g, " ")
      // The space this stripper itself put in front of the punctuation that follows an inline link.
      .replace(/\s+([,.;:!?])/g, "$1")
      .trim()
  );
}

const flat = (text: string): string => text.replace(/\s+/g, " ").trim();

/** What the builder is handed: the page whose button completes the sign-in, and the credential on it. */
const URL_ = "https://frankfurtleague.de/signin/bestaetigen?token=abc123";

/** The one interpolated value, carrying every character `escapeHtml` covers. An address is typed by hand. */
const HOSTILE_URL = `https://frankfurtleague.de/x?email=a"<script>&b='c'`;

const FUSS_SATZ = `Antworten an die Absenderadresse liest niemand; unsere Adresse ist ${KONTAKT_EMAIL}.`;
const IGNORIER_SATZ = "Du hast diese Anmeldung nicht angefordert? Dann ignoriere diese E-Mail einfach. Ohne den Link passiert nichts.";

/** The shell's close as this branch ends on it: the block a folded delimiter line would swallow whole. */
const TEXT_SCHLUSS = [
  "-- ",
  FUSS_SATZ,
  `Datenschutzerklärung: ${ORIGIN}/datenschutz`,
  `Impressum: ${ORIGIN}/impressum`,
  `${VEREIN_NAME}, ${VEREIN_ANSCHRIFT}`,
].join("\n");

describe("how long the mailed link stays good for", () => {
  /* The literal, because every other case here derives its expectation from the constant and so
     passes at any figure. A link is a bearer credential in an inbox, and this is what bounds it. */
  it("is ten minutes", () => {
    assert.equal(LINK_VALIDITY_MINUTES, 10);
  });
});

describe("buildMagicLinkEmail", () => {
  /* A mail client renders one branch or the other, so a fact only one half carried would reach only
     half the readers -- and here that fact is the link the message exists to deliver. */
  it("states the same facts in both branches", () => {
    const mail = buildMagicLinkEmail(URL_, ORIGIN);

    for (const fakt of [URL_, "Anmeldung bestätigen", GUELTIGKEIT, "kann nur einmal verwendet werden", IGNORIER_SATZ]) {
      assert.ok(flat(readable(mail.html)).includes(fakt), `the HTML branch lost „${fakt}“`);
      assert.ok(flat(mail.text).includes(fakt), `the text branch lost „${fakt}“`);
    }
    assert.equal(mail.subject, "Anmeldelink für Frankfurt League");
  });

  /* One constant carries the figure, so what this case holds is the SENTENCE around it: a reader
     told the link lasts longer than it does trusts one that has expired. */
  it("sets that figure in the sentence a reader acts on, in both branches", () => {
    const mail = buildMagicLinkEmail(URL_, ORIGIN);

    assert.ok(readable(mail.html).includes(`Der Link ist ${GUELTIGKEIT} gültig`));
    assert.ok(mail.text.includes(`Er ist ${GUELTIGKEIT} gültig`));
  });

  /* The URL carries a minted credential and reaches the markup as a value like any other -- an
     unescaped `&` alone already makes the document invalid. */
  it("escapes the link it is handed", () => {
    const mail = buildMagicLinkEmail(HOSTILE_URL, ORIGIN);

    assert.ok(!mail.html.includes("<script>"), "an unescaped tag reached the markup");
    assert.ok(mail.html.includes("&amp;b=&#39;c&#39;"), "the query string reached the markup unescaped");
    // Decoding the markup back returns the link, so escaping changed the encoding and not the address.
    assert.ok(readable(mail.html).includes(HOSTILE_URL));
    assert.ok(mail.text.includes(HOSTILE_URL), "the text branch must carry the link as written");
  });

  /* One control, where the three application messages carry a pair: a second destination beside it
     competes with the one press this message exists for. */
  it("offers the link as its only control, and again as an address to copy", () => {
    const mail = buildMagicLinkEmail(URL_, ORIGIN);
    const steuer = mail.html.slice(mail.html.indexOf("<hr"), mail.html.indexOf("<hr", mail.html.indexOf("<hr") + 1));
    const ziele = [...steuer.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((treffer) => `${treffer[2]}`);

    assert.deepEqual(ziele, ["Jetzt anmelden"], "the sign-in message no longer offers exactly one control");
    assert.ok(steuer.includes(`href="${URL_.replaceAll("&", "&amp;")}"`), "the control does not point at the link");
    // The fallback line stands in the body, above the rule: a client that mangles the button leaves it.
    assert.ok(mail.html.indexOf("kopiere diese Adresse") < mail.html.indexOf("<hr"), "the fallback fell below the control");
  });

  /* Where the note stands decides whether the reader it exists for reaches it: last in the body, above
     the rule, and never down in the grey close -- as it stands in the application messages. */
  it("places the note for a reader who requested nothing above the controls", () => {
    const mail = buildMagicLinkEmail(URL_, ORIGIN);
    const auf = mail.html.lastIndexOf("<p ", mail.html.indexOf(IGNORIER_SATZ));
    const grade = mail.html.slice(auf, mail.html.indexOf(">", auf));

    assert.ok(mail.html.indexOf(IGNORIER_SATZ) < mail.html.indexOf("<hr"), "the note fell below the rule");
    assert.ok(grade.includes("font-size:13px"), "the note is not set in the aside grade");
    assert.ok(readable(mail.html.slice(mail.html.lastIndexOf("<hr"))).includes(FUSS_SATZ), "the close no longer says replies are unread");
  });

  /* The escaping test's counterpart, against the text branch's own hazard: a client folding at a
     delimiter line inside the link hides every line below it, the whole footer included. */
  it("keeps the link it is handed from opening a second signature block", () => {
    const mail = buildMagicLinkEmail("https://frankfurtleague.de/x\n-- \nZweite Zeile", ORIGIN);

    assert.equal([...mail.text.matchAll(/^-- $/gm)].length, 1, "the link stands as a second signature delimiter");
    assert.ok(mail.text.includes("\n -- \n"), "the link's delimiter line was dropped rather than stuffed");
    assert.ok(mail.text.includes("Zweite Zeile"), "the line below the delimiter was lost");
    assert.ok(mail.text.endsWith(`\n${TEXT_SCHLUSS}`), "the link pushed the footer out of the close");
  });

  it("closes the text branch with RFC 3676's signature delimiter", () => {
    const mail = buildMagicLinkEmail(URL_, ORIGIN);

    assert.ok(mail.text.includes("\n-- \n"), "without the trailing space no client folds the footer");
    assert.ok(mail.text.endsWith(`\n${TEXT_SCHLUSS}`), "the text branch no longer closes on its footer");
    assert.ok(mail.text.indexOf(IGNORIER_SATZ) < mail.text.indexOf("\n-- \n"), "the note fell below the signature delimiter");
  });
});
