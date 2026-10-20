import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertRedactedAtTheEdge } from "./edgeRedaction.ts";
import { registerDoubles } from "./exportingModule.ts";
import { flat, readable } from "./mailText.ts";

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";

registerDoubles();

const {
  adresswechselLink,
  buildAdresswechselEmail,
  buildAdresswechselGenehmigungEmail,
  buildAdresswechselHinweisEmail,
  buildAdresswechselNichtWirksamEmail,
  buildAdresswechselWirksamEmail,
} = await import("./adresswechselEmail.ts");
const { ADRESSWECHSEL_STOPPEN } = await import("./adresswechselAntworten.ts");
const { KONTO_HREF } = await import("./kontoHref.ts");
const { KONTAKT_EMAIL } = await import("./brand.ts");

/** 13:30 in Berlin, so a page or a mail stating it in UTC would print another hour. */
const GUELTIG_BIS = "2026-10-21T11:30:00Z";
const BERLIN = "21. Oktober 2026 um 13:30";

const LINK = { origin: ORIGIN, token: "neu-token", weg: "konto", gueltigBis: GUELTIG_BIS } as const;
const HINWEIS = { origin: ORIGIN, stoppToken: "stopp-token", weg: "konto", gueltigBis: GUELTIG_BIS, vorname: "Mira" } as const;

const beide = (mail: { html: string; text: string }): readonly string[] => [readable(mail.html), flat(mail.text)];

describe("the links an address change spells", () => {
  /* One page for every record: the token alone says which change, live or ended, and which side. */
  it("puts every token on the one address page", () => {
    assert.equal(adresswechselLink(ORIGIN, "t"), `${ORIGIN}/bestaetigung/adresse?token=t`);
  });

  it("names a parameter the edge's own redaction map replaces, the stop link's too", () => {
    assertRedactedAtTheEdge(adresswechselLink(ORIGIN, "neu-token"));
    assertRedactedAtTheEdge(adresswechselLink(ORIGIN, "stopp-token"));
  });

  it("escapes a token whose characters would otherwise end the query", () => {
    assert.equal(adresswechselLink(ORIGIN, "a b&c=d"), `${ORIGIN}/bestaetigung/adresse?token=a%20b%26c%3Dd`);
  });
});

describe("the link to the new address", () => {
  /* The deadline is an instant now: stated as a day, a link lapsing at 13:30 reads as open all evening. */
  it("states its deadline to the minute in Berlin, in both parts", () => {
    for (const words of beide(buildAdresswechselEmail(LINK))) assert.ok(words.includes(`bis ${BERLIN}`), `no deadline in: ${words}`);
  });

  it("says who typed the address, the person on the account page and the administration otherwise", () => {
    for (const words of beide(buildAdresswechselEmail(LINK))) assert.match(words, /wurde diese E-Mail-Adresse als neue angegeben/);
    for (const weg of ["freigabe", "wartezeit"] as const) {
      for (const words of beide(buildAdresswechselEmail({ ...LINK, weg })))
        assert.match(words, /die Verwaltung der Frankfurt League hat diese/);
    }
  });

  it("tells a change with a waiting time that the address holds only days after the confirmation", () => {
    for (const words of beide(buildAdresswechselEmail({ ...LINK, weg: "wartezeit" }))) assert.match(words, /gilt sie eine Woche später/);
    for (const words of beide(buildAdresswechselEmail(LINK))) assert.doesNotMatch(words, /eine Woche später/);
  });
});

describe("the notice to the address on file", () => {
  const stopp = adresswechselLink(ORIGIN, "stopp-token");

  it("carries the stop link on a control and in both parts, whichever way the change began", () => {
    for (const weg of ["konto", "freigabe", "wartezeit"] as const) {
      const mail = buildAdresswechselHinweisEmail({ ...HINWEIS, weg });

      assert.ok(mail.html.includes(`href="${stopp}"`), `${weg}'s notice offers no stop`);
      assert.ok(mail.html.includes(`>${ADRESSWECHSEL_STOPPEN}</a>`), `${weg}'s stop control is named otherwise`);
      assert.ok(mail.text.includes(stopp), `${weg}'s text part carries no stop link`);
    }
  });

  /* No link approves anything: the approval asks a fresh sign-in, so the way there carries no credential. */
  it("sends an approval to the account page with no token, and states that page's deadline", () => {
    const mail = buildAdresswechselHinweisEmail({ ...HINWEIS, weg: "freigabe" });

    assert.ok(mail.html.includes(`href="${ORIGIN}${KONTO_HREF}"`), "the approval names no account page");
    for (const words of beide(mail)) assert.ok(words.includes(`bis ${BERLIN}`), "the approval states no deadline");
    assert.ok(
      !buildAdresswechselHinweisEmail(HINWEIS).html.includes(`${KONTO_HREF}"`),
      "a change waiting on no approval sends the reader to approve",
    );
  });

  /* The request exists so a real holder can refuse a pretext: its first instruction is never to approve. */
  it("asks an approval in the words every notice uses, warns before it, and leads with the stop", () => {
    const freigabe = buildAdresswechselHinweisEmail({ ...HINWEIS, weg: "freigabe" });

    assert.equal(freigabe.subject, buildAdresswechselHinweisEmail(HINWEIS).subject, "the approval's subject tells the reader to approve");
    assert.doesNotMatch(freigabe.subject, /frei/i);
    for (const words of beide(freigabe)) assert.match(words, /Gib sie nur frei, wenn Du das selbst bei uns angefragt hast\./);
    assert.ok(
      freigabe.html.indexOf(`>${ADRESSWECHSEL_STOPPEN}</a>`) < freigabe.html.indexOf(">Zu Deinem Konto</a>"),
      "the approval's control leads the stop",
    );
  });

  it("greets the address on file by its first name, and nobody where the record holds none", () => {
    for (const words of beide(buildAdresswechselHinweisEmail(HINWEIS))) assert.match(words, /Hallo Mira, in Deinem Konto/);
    for (const words of beide(buildAdresswechselHinweisEmail({ ...HINWEIS, vorname: "" }))) assert.match(words, /Hallo, in Deinem Konto/);
  });
});

describe("the completion notice to the replaced address", () => {
  const mail = buildAdresswechselWirksamEmail({ origin: ORIGIN, vorname: "Mira", zeitpunkt: new Date(GUELTIG_BIS) });

  it("states when the change took effect and how to repudiate it, in both parts", () => {
    for (const words of beide(mail)) {
      assert.ok(words.includes(`seit ${BERLIN} eine neue E-Mail-Adresse`), "no instant of the effect");
      assert.match(words, /Hast Du das nicht veranlasst\? Schreib uns sofort an/);
    }
  });

  /* A seat not yet confirmed stays at the replaced address and still signs in there. */
  it("never claims the replaced address stops signing in", () => {
    for (const words of beide(mail)) assert.doesNotMatch(words, /nicht mehr an/);
  });

  /* The change is done: a control would offer an action nothing on the page can take. */
  it("offers no control and no token link", () => {
    assert.ok(!mail.html.includes("token="), "the completion notice carries a link a press could spend");
    assert.doesNotMatch(mail.html, /<td[^>]*class="fl-action/, "the completion notice draws a control");
  });
});

describe("the new address's notice of a change that did not take effect", () => {
  const mail = buildAdresswechselNichtWirksamEmail({ origin: ORIGIN });

  /* A ban on this very address is among the reasons, and its holder may be a stranger: nothing names either. */
  it("says the change did not take effect and where to ask, naming no person and no reason", () => {
    for (const words of beide(mail)) {
      assert.match(words, /Hallo, die Änderung Deiner E-Mail-Adresse ist nicht wirksam geworden\. Wir helfen Dir gern weiter:/);
      assert.doesNotMatch(words, /Sperr|gesperrt|Spielerin|Grund/);
    }
    assert.doesNotMatch(mail.html, /<td[^>]*class="fl-action/, "the notice draws a control");
  });
});

describe("the approvers' notice of a change waiting for them", () => {
  const mail = buildAdresswechselGenehmigungEmail({ origin: ORIGIN });

  /* Whoever reads it signs in to learn the rest: the mail is no place for either address of an administrator. */
  it("links to the administrators page, carrying no id and naming no address", () => {
    assert.ok(mail.html.includes(`href="${ORIGIN}/bereich/admin/administratoren"`), "the notice names another page");
    for (const words of beide(mail)) {
      // The league's own contact line excepted, which every message closes on.
      assert.doesNotMatch(words.replaceAll(KONTAKT_EMAIL, ""), /@[a-z]/, "the notice names an address");
      assert.doesNotMatch(words, /adresswechsel=|token=/, "the notice carries an id or a credential");
      assert.match(words, /stimme nur zu, wenn Du sicher bist, dass die Person sie selbst angefragt hat/);
    }
  });
});

/* `docs/frontend/spec.md :: I89`: these messages carry no column of facts, so every value the prose
   prints is folded by its builder or by nothing. */
describe("no value can open a line of its own in the text part", () => {
  const FORGED_OPENER = "Startgeld: 500 Euro";
  const wert = `Wert\n${FORGED_OPENER}`;

  it("folds every name a message prints onto one line, in the text part and the subject", () => {
    for (const mail of [
      buildAdresswechselHinweisEmail({ ...HINWEIS, vorname: wert }),
      buildAdresswechselWirksamEmail({ origin: ORIGIN, vorname: wert, zeitpunkt: new Date(GUELTIG_BIS) }),
    ]) {
      assert.ok(!mail.text.split("\n").some((line) => line.startsWith(FORGED_OPENER)), "a name forged a line");
      assert.ok(mail.text.includes(`Wert ${FORGED_OPENER}`), "a name was not carried onto one line");
      assert.ok(!/[\r\n]/.test(mail.subject), "a name put a break in the subject");
    }
  });
});
