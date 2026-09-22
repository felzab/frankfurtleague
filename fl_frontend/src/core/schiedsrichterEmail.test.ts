import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";

import { redactedParameterNames } from "./edgeRedaction.ts";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { buildSchiedsrichterBestaetigungEmail, schiedsrichterBestaetigungsLink, SCHIEDSRICHTER_BESTAETIGUNG_PATH } =
  await import("./schiedsrichterEmail.ts");
const { KONTAKT_EMAIL } = await import("./brand.ts");

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";

const TOKEN = "abc123";
const FRIST = "05.10.2026";

/** The markup branch reduced to the facts a reader ends up with, so a fact is checked as a fact in both branches. */
function readable(html: string): string {
  let stripped = html;

  // To a FIXPOINT: a pattern leaving a tag standing hands the caller markup to read as text
  // (`fl_frontend/src/shared/testing/renderTest.ts :: textOf`).
  for (let previous = ""; stripped !== previous;) {
    previous = stripped;
    stripped = stripped.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, " ");
  }

  return stripped
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

const flat = (text: string): string => text.replace(/\s+/g, " ").trim();

const daten = { origin: ORIGIN, vorname: "Anna", token: TOKEN, fristText: FRIST };

/* Every module that mints this link, read as source: which variable a call site hands the builder is
   nothing a render shows. One entry today; the sweep is what a second minter has to satisfy. */
const MINTER = ["../features/schiedsrichter/notifications.ts"].map((relativ) => ({
  name: relativ,
  source: readFileSync(path.resolve(import.meta.dirname, relativ), "utf8"),
}));

describe("the link this message spells", () => {
  it("puts the token on the origin it was handed, under the referee's confirmation path", () => {
    assert.equal(schiedsrichterBestaetigungsLink(ORIGIN, TOKEN), `${ORIGIN}${SCHIEDSRICHTER_BESTAETIGUNG_PATH}?token=${TOKEN}`);
  });

  /* The name is the whole of what the edge matches on (`docs/logging/spec.md :: L11`), so a link
     spelled with any other parameter writes the credential into the access line and the referer. */
  it("names a parameter the edge's own redaction map replaces", () => {
    const redacted = redactedParameterNames();
    const name = /\?(\w+)=/.exec(schiedsrichterBestaetigungsLink(ORIGIN, TOKEN))?.[1] ?? "";

    assert.ok(redacted.length > 0, "the edge's map was read as replacing no parameter at all, so this case compares nothing");
    assert.ok(redacted.includes(name), `the link is spelled \`${name}=\`, which the edge does not redact`);
  });

  /* A link built on the published origin sends a reader of the local stack into production, and the
     two origins are separate settings for the reason `docs/frontend/spec.md :: I186` gives. */
  it("is minted on the configured origin by every module that mints one, and on the published one by none", () => {
    for (const { name, source } of MINTER) {
      assert.match(source, /origin: frontend_config\.AUTH_URL/, `${name} hands the builder something other than the configured origin`);
      // The import rather than the identifier: a comment naming the published origin to refuse it is
      // not a use of it.
      assert.doesNotMatch(source, /^import \{[^}]*\bSITE_URL\b/m, `${name} imports the published origin`);
    }
  });

  /* The origin is normalised INSIDE the builder, which is what puts a trailing slash on
     `AUTH_URL` in front of `emailShell.test.ts`'s sweep rather than into a recipient's inbox. */
  it("normalises the origin before the link is spelled, not after", () => {
    const gebaut = buildSchiedsrichterBestaetigungEmail({ ...daten, origin: `${ORIGIN}/` });

    assert.ok(gebaut.html.includes(`${ORIGIN}${SCHIEDSRICHTER_BESTAETIGUNG_PATH}?token=`), "a configured trailing slash reaches the link");
  });

  it("escapes a token whose characters would otherwise end the query", () => {
    assert.equal(schiedsrichterBestaetigungsLink(ORIGIN, "a b&c=d"), `${ORIGIN}${SCHIEDSRICHTER_BESTAETIGUNG_PATH}?token=a%20b%26c%3Dd`);
  });

  it("lands on the segment the page is served at, never a query on a shared page", () => {
    assert.equal(SCHIEDSRICHTER_BESTAETIGUNG_PATH, "/bestaetigung/schiedsrichter");
  });
});

describe("the referee's confirmation message", () => {
  const mail = buildSchiedsrichterBestaetigungEmail(daten);

  it("carries the live link in both branches", () => {
    const url = schiedsrichterBestaetigungsLink(ORIGIN, TOKEN);

    assert.ok(mail.html.includes(url), "the markup branch carries no link");
    assert.ok(mail.text.includes(url), "the text branch carries no link");
  });

  /* Both branches state the same facts: a reader whose client shows the text part must be told what
     the markup part tells the one beside them. */
  it("states the deadline and greets the person in both branches", () => {
    for (const [branch, words] of [
      ["html", readable(mail.html)],
      ["text", flat(mail.text)],
    ] as const) {
      assert.match(words, /Hallo Anna,/, `the ${branch} branch greets nobody`);
      assert.ok(words.includes(FRIST), `the ${branch} branch names no deadline`);
      assert.match(words, /funktioniert nur einmal/, `the ${branch} branch does not say the link is one-time`);
    }
  });

  /* The one sentence no application message can carry: an administrator typed this address, so a
     reader who never agreed to officiate has to be told what ignoring the message costs. */
  it("tells a reader who knows of no entry what happens if they ignore it", () => {
    for (const words of [readable(mail.html), flat(mail.text)]) {
      assert.match(words, /Du weißt nichts von einem Eintrag/);
      assert.match(words, /erscheint Dein Name nirgends auf der Website/);
      assert.ok(words.includes(KONTAKT_EMAIL), "the escape route names no address");
    }
  });

  it("says on the subject line what is being asked", () => {
    assert.match(mail.subject, /^Bitte bestätigen: Dein Eintrag bei der /);
  });

  /* The text branch is line-oriented, so a newline inside a value renders a line the reader cannot
     tell from the facts around it. */
  it("folds a multi-line forename into one line in both branches", () => {
    const gefaltet = buildSchiedsrichterBestaetigungEmail({ ...daten, vorname: "Anna\nAbsenderadresse: niemand" });

    assert.ok(!gefaltet.text.includes("Anna\nAbsenderadresse"), "a typed newline reached the text branch");
    assert.match(flat(gefaltet.text), /Hallo Anna Absenderadresse: niemand,/);
  });

  it("escapes a forename carrying markup rather than serving it", () => {
    const feindlich = buildSchiedsrichterBestaetigungEmail({ ...daten, vorname: "<script>a</script>" });

    assert.ok(!feindlich.html.includes("<script>"), "the forename reached the markup branch unescaped");
    assert.match(readable(feindlich.html), /Hallo <script>a<\/script>,/);
  });

  /* `fl_frontend/src/core/emailShell.ts :: mailOrigin` is what keeps a stack that is not production
     from mailing production links (`docs/frontend/spec.md :: I186`). */
  it("builds the link on the origin it was handed", () => {
    const fremd = buildSchiedsrichterBestaetigungEmail({ ...daten, origin: "https://beispiel.test" });

    assert.ok(fremd.html.includes(`https://beispiel.test${SCHIEDSRICHTER_BESTAETIGUNG_PATH}?token=${TOKEN}`));
    assert.ok(!fremd.text.includes(ORIGIN), "the text branch carries an origin nobody handed it");
  });
});
