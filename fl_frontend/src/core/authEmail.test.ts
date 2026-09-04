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

const { buildMagicLinkEmail } = await import("./authEmail.ts");
const { KONTAKT_EMAIL, SITE_URL, VEREIN_ANSCHRIFT, VEREIN_NAME } = await import("./brand.ts");

/** The markup branch reduced to the facts a reader ends up with, so a fact is checked as a fact in both branches. */
function readable(html: string): string {
  return (
    html
      .replace(/<style[\s\S]*?<\/style>/g, " ")
      .replace(/<[^>]*>/g, " ")
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

/** What Auth.js hands the builder: its own origin, plus the address a stranger typed into the sign-in form. */
const URL_ = "https://frankfurtleague.de/api/auth/callback/resend?callbackUrl=%2Fadmin&token=abc123&email=erika%40beispiel.de";

/** The one interpolated value, carrying every character `escapeHtml` covers. An address is typed by hand. */
const HOSTILE_URL = `https://frankfurtleague.de/x?email=a"<script>&b='c'`;

const FUSS_SATZ = `Antworten an die Absenderadresse liest niemand; unsere Adresse ist ${KONTAKT_EMAIL}.`;
const IGNORIER_SATZ = "Du hast diese Anmeldung nicht angefordert? Dann ignoriere diese E-Mail einfach. Ohne den Link passiert nichts.";

/** The shell's close as this branch ends on it: the block a folded delimiter line would swallow whole. */
const TEXT_SCHLUSS = [
  "-- ",
  FUSS_SATZ,
  `Datenschutzerklärung: ${SITE_URL}/datenschutz`,
  `Impressum: ${SITE_URL}/impressum`,
  `${VEREIN_NAME}, ${VEREIN_ANSCHRIFT}`,
].join("\n");

describe("buildMagicLinkEmail", () => {
  /* A mail client renders one branch or the other, so a fact only one half carried would reach only
     half the readers -- and here that fact is the link the message exists to deliver. */
  it("states the same facts in both branches", () => {
    const mail = buildMagicLinkEmail(URL_);

    for (const fakt of [URL_, "Anmeldung bestätigen", "15 Minuten", "kann nur einmal verwendet werden", IGNORIER_SATZ]) {
      assert.ok(flat(readable(mail.html)).includes(fakt), `the HTML branch lost „${fakt}“`);
      assert.ok(flat(mail.text).includes(fakt), `the text branch lost „${fakt}“`);
    }
    assert.equal(mail.subject, "Anmeldelink für Frankfurt-League");
  });

  /* The validity the message states is copy, and the TTL that enforces it is Auth.js's. A reader told
     the wrong number asks for a link that has already expired, or trusts one that has. */
  it("states the validity its own constant carries, in both branches", () => {
    const mail = buildMagicLinkEmail(URL_);

    assert.ok(readable(mail.html).includes("Der Link ist 15 Minuten gültig"));
    assert.ok(mail.text.includes("Er ist 15 Minuten gültig"));
  });

  /* Auth.js builds the URL from the address typed into a public form, so it reaches the markup as a
     caller's value like any other -- an unescaped `&` alone already makes the document invalid. */
  it("escapes the link it is handed", () => {
    const mail = buildMagicLinkEmail(HOSTILE_URL);

    assert.ok(!mail.html.includes("<script>"), "an unescaped tag reached the markup");
    assert.ok(mail.html.includes("&amp;b=&#39;c&#39;"), "the query string reached the markup unescaped");
    // Decoding the markup back returns the link, so escaping changed the encoding and not the address.
    assert.ok(readable(mail.html).includes(HOSTILE_URL));
    assert.ok(mail.text.includes(HOSTILE_URL), "the text branch must carry the link as written");
  });

  /* One control, where the three application messages carry a pair: a second destination beside it
     competes with the one press this message exists for. */
  it("offers the link as its only control, and again as an address to copy", () => {
    const mail = buildMagicLinkEmail(URL_);
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
    const mail = buildMagicLinkEmail(URL_);
    const auf = mail.html.lastIndexOf("<p ", mail.html.indexOf(IGNORIER_SATZ));
    const grade = mail.html.slice(auf, mail.html.indexOf(">", auf));

    assert.ok(mail.html.indexOf(IGNORIER_SATZ) < mail.html.indexOf("<hr"), "the note fell below the rule");
    assert.ok(grade.includes("font-size:13px"), "the note is not set in the aside grade");
    assert.ok(readable(mail.html.slice(mail.html.lastIndexOf("<hr"))).includes(FUSS_SATZ), "the close no longer says replies are unread");
  });

  /* The escaping test's counterpart, against the text branch's own hazard: a client folding at a
     delimiter line inside the link hides every line below it, the whole footer included. */
  it("keeps the link it is handed from opening a second signature block", () => {
    const mail = buildMagicLinkEmail("https://frankfurtleague.de/x\n-- \nZweite Zeile");

    assert.equal([...mail.text.matchAll(/^-- $/gm)].length, 1, "the link stands as a second signature delimiter");
    assert.ok(mail.text.includes("\n -- \n"), "the link's delimiter line was dropped rather than stuffed");
    assert.ok(mail.text.includes("Zweite Zeile"), "the line below the delimiter was lost");
    assert.ok(mail.text.endsWith(`\n${TEXT_SCHLUSS}`), "the link pushed the footer out of the close");
  });

  it("closes the text branch with RFC 3676's signature delimiter", () => {
    const mail = buildMagicLinkEmail(URL_);

    assert.ok(mail.text.includes("\n-- \n"), "without the trailing space no client folds the footer");
    assert.ok(mail.text.endsWith(`\n${TEXT_SCHLUSS}`), "the text branch no longer closes on its footer");
    assert.ok(mail.text.indexOf(IGNORIER_SATZ) < mail.text.indexOf("\n-- \n"), "the note fell below the signature delimiter");
  });
});
