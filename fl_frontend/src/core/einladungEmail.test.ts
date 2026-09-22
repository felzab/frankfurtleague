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

const { buildEinladungEmail } = await import("./einladungEmail.ts");
const { KONTAKT_EMAIL, VEREIN_ANSCHRIFT, VEREIN_NAME } = await import("./brand.ts");

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";

const URL_ = `${ORIGIN}/registrierung?token=abc123`;

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

const daten = { teamName: "Goethe-Gymnasium", saisonId: "2026", origin: ORIGIN, link: URL_ };

const FUSS_SATZ = `Antworten an die Absenderadresse liest niemand; unsere Adresse ist ${KONTAKT_EMAIL}.`;

/** The shell's close as this branch ends on it: the block a folded delimiter line would swallow whole. */
const TEXT_SCHLUSS = [
  "-- ",
  FUSS_SATZ,
  `Datenschutzerklärung: ${ORIGIN}/datenschutz`,
  `Impressum: ${ORIGIN}/impressum`,
  `${VEREIN_NAME}, ${VEREIN_ANSCHRIFT}`,
].join("\n");

describe("buildEinladungEmail", () => {
  /* A mail client renders one branch or the other, so a fact only one half carried would reach only
     half the readers — and here that fact is the link the message exists to deliver. */
  it("states the same facts in both branches", () => {
    const mail = buildEinladungEmail(daten);

    for (const fakt of [
      URL_,
      "Goethe-Gymnasium",
      "Saison 2026",
      "Der Link gilt, solange die Registrierung für diese Saison geöffnet ist.",
      "Erst mit der Aufnahme in den Kader steht die Person darin",
    ]) {
      assert.ok(flat(readable(mail.html)).includes(fakt), `the HTML branch lost „${fakt}“`);
      assert.ok(flat(mail.text).includes(fakt), `the text branch lost „${fakt}“`);
    }
    assert.equal(mail.subject, "Registrierungslink für Goethe-Gymnasium: Frankfurt League, Saison 2026");
  });

  /* A club name is typed outside the league and reaches the markup as a value like any other, and
     the link carries a minted credential whose unescaped `&` alone makes the document invalid. */
  it("escapes the club name and the link it is handed", () => {
    const mail = buildEinladungEmail({ ...daten, teamName: `<script>a&b`, link: `${ORIGIN}/registrierung?token=a"&b='c'` });

    assert.ok(!mail.html.includes("<script>"), "an unescaped tag reached the markup");
    assert.ok(mail.html.includes("&amp;b=&#39;c&#39;"), "the query string reached the markup unescaped");
    // Decoding the markup back returns both values, so escaping changed the encoding and not them.
    assert.ok(readable(mail.html).includes("<script>a&b"));
    assert.ok(readable(mail.html).includes(`${ORIGIN}/registrierung?token=a"&b='c'`));
  });

  /* One control, where the three application messages carry a pair: a second destination beside it
     competes with the one press this message exists for. */
  it("offers the link as its only control, and again as an address to copy", () => {
    const mail = buildEinladungEmail(daten);
    const steuer = mail.html.slice(mail.html.indexOf("<hr"), mail.html.indexOf("<hr", mail.html.indexOf("<hr") + 1));
    const ziele = [...steuer.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((treffer) => `${treffer[2]}`);

    assert.deepEqual(ziele, ["Zur Registrierung"], "the invite message no longer offers exactly one control");
    assert.ok(steuer.includes(`href="${URL_}"`), "the control does not point at the link");
    // Presence before position, for the reason the note's own case records: -1 sits below every offset.
    assert.ok(mail.html.includes("kopiere diese Adresse"), "the address a reader can copy by hand is gone from the message");
    // The fallback line stands in the body, above the rule: a client that mangles the button leaves it.
    assert.ok(mail.html.indexOf("kopiere diese Adresse") < mail.html.indexOf("<hr"), "the fallback fell below the control");
  });

  /* The containment is what a reader decides how widely to forward the link on, so it stands in the
     body above the rule rather than down in the grey close. */
  it("places the note about who the link admits above the controls", () => {
    const mail = buildEinladungEmail(daten);
    const satz = "Behandle den Link wie einen Schlüssel";

    // Before the ordering: `indexOf` answers -1 for an absent sentence, which is below every offset,
    // so a message carrying no note at all would pass the comparison beneath this one.
    assert.ok(mail.html.includes(satz), "the note about who the link admits is gone from the message");
    assert.ok(mail.html.indexOf(satz) < mail.html.indexOf("<hr"), "the note fell below the rule");
    assert.ok(readable(mail.html.slice(mail.html.lastIndexOf("<hr"))).includes(FUSS_SATZ), "the close no longer says replies are unread");
  });

  /* The escaping test's counterpart, against the text branch's own hazard: a client folding at a
     delimiter line inside a value hides every line below it, the whole footer included. */
  it("keeps the club name it is handed from opening a second signature block", () => {
    const mail = buildEinladungEmail({ ...daten, teamName: "Goethe\n-- \nZweite Zeile" });

    assert.equal([...mail.text.matchAll(/^-- $/gm)].length, 1, "the club name stands as a second signature delimiter");
    assert.ok(mail.text.includes("\n -- \n"), "the club name's delimiter line was dropped rather than stuffed");
    assert.ok(mail.text.includes("Zweite Zeile"), "the line below the delimiter was lost");
    assert.ok(mail.text.endsWith(`\n${TEXT_SCHLUSS}`), "the club name pushed the footer out of the close");
  });

  it("closes the text branch with RFC 3676's signature delimiter", () => {
    const mail = buildEinladungEmail(daten);

    assert.ok(mail.text.includes("\n-- \n"), "without the trailing space no client folds the footer");
    assert.ok(mail.text.endsWith(`\n${TEXT_SCHLUSS}`), "the text branch no longer closes on its footer");
  });
});
