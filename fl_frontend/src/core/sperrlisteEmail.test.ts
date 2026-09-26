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

const { buildSperreEmail } = await import("./sperrlisteEmail.ts");
const { KONTAKT_EMAIL } = await import("./brand.ts");

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";

const GRUND = "Falsches Geburtsdatum bei der Anmeldung";
const BIS = "2031";

const MAIL = buildSperreEmail({ grund: GRUND, gesperrtBisSaisonId: BIS, origin: ORIGIN });

/** Both branches of one message, so no fact can reach only the readers whose client renders HTML. */
const BEIDE = [
  { name: "the card", body: MAIL.html },
  { name: "the text branch", body: MAIL.text },
];

describe("the message a banned address is sent", () => {
  /* „bis 2031“ alone reads as the season the ban ENDS in, which is a year early. The fragment is the
     owner's and is stated character for character in both branches. */
  it("states the bound inclusively, in both branches", () => {
    for (const { name, body } of BEIDE) {
      assert.ok(body.includes(`bis einschließlich der Saison ${BIS}`), `${name} does not say which season is the last one barred`);
    }
  });

  it("says what is barred, why, what is kept and how to object", () => {
    for (const { name, body } of BEIDE) {
      assert.ok(body.includes("gesperrt"), `${name} does not say the address is barred`);
      assert.ok(body.includes(GRUND), `${name} does not carry the reason that was entered`);
      assert.ok(body.includes("Fingerabdruck"), `${name} does not say what is kept about the address`);
      assert.ok(body.includes(KONTAKT_EMAIL), `${name} offers no way to object or ask`);
    }
  });

  /* Every act the ban refuses, the sign-in among them, and the sign-ins it ends: a reader told less
     would try the rest and meet a refusal the one message they get never named. */
  it("names every act a ban refuses, and that live sign-ins end while the account is kept", () => {
    for (const { name, body } of BEIDE) {
      assert.ok(body.includes("weder anmelden"), `${name} does not say a sign-in is refused`);
      assert.ok(body.includes("registrieren"), `${name} does not say a registration is refused`);
      assert.ok(body.includes("Kontaktperson in einer Bewerbung"), `${name} does not say an application's contact seat is refused`);
      assert.ok(body.includes("Schiedsrichter"), `${name} does not say a referee entry is refused`);
      assert.ok(body.includes("Anmeldungen mit dieser Adresse werden beendet"), `${name} does not say live sign-ins end`);
      assert.ok(body.includes("Dein Zugang bleibt erhalten"), `${name} does not say the account is kept`);
    }
  });

  /* This message is the whole of what a barred person is ever sent: the notice that would carry
     these is a page nobody has sent them to. Art. 21 (4) asks for the objection EXPLICITLY. */
  it("names the legal basis and the right to object, and says the ban ends by itself", () => {
    for (const { name, body } of BEIDE) {
      assert.ok(body.includes("Art. 6 Abs. 1 lit. f DSGVO"), `${name} names no legal basis`);
      assert.ok(body.includes("Art. 21 DSGVO widersprechen"), `${name} does not bring the objection right to the reader`);
      assert.ok(body.includes("endet die Sperre von selbst"), `${name} does not state the lapse the ban form promises it explains`);
    }
    assert.match(
      MAIL.html,
      /Schreib uns dafür an <a href="mailto:[^"]+"[^>]*>[^<]+<\/a>; dort beantworten wir auch Fragen zur Sperre\.<\/p>/,
      "the card's objection is an address to copy, not a link",
    );
  });

  /* A message quoting the address back would put it in a mailbox, a provider's log and a bounce
     report — every place the keyed hash exists to keep one out of. */
  it("carries no address but the league's own", () => {
    const recipient = "zorbanax@beispielschule.de";
    const mail = buildSperreEmail({ grund: GRUND, gesperrtBisSaisonId: BIS, origin: ORIGIN });

    for (const body of [mail.html, mail.text]) {
      assert.ok(!body.includes(recipient), "the message quotes the address it is sent to");
      for (const found of body.matchAll(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g)) {
        assert.equal(found[0], KONTAKT_EMAIL, `the message carries ${found[0]}`);
      }
    }
  });

  /* An administrator's free text lands inside markup no framework is watching
     (`fl_frontend/src/core/emailShell.ts :: escapeHtml`). */
  it("escapes a reason carrying markup and leaves the text branch raw", () => {
    const hostile = 'Angabe <b>"falsch"</b> & nicht belegt';
    const mail = buildSperreEmail({ grund: hostile, gesperrtBisSaisonId: BIS, origin: ORIGIN });

    assert.ok(mail.html.includes("Angabe &lt;b&gt;&quot;falsch&quot;&lt;/b&gt; &amp; nicht belegt"), "the reason reaches the card raw");
    assert.ok(!mail.html.includes("<b>"), "the reason opens a tag in the card");
    assert.ok(mail.text.includes(hostile), "the text branch escapes a value no client parses");
  });
});
