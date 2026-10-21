import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertRedactedAtTheEdge } from "./edgeRedaction.ts";
import { registerDoubles } from "./exportingModule.ts";
import { flat, readable } from "./mailText.ts";
import { DEIN_BEREICH_TITEL } from "./seitenNamen.ts";

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";

registerDoubles();

const { buildKontaktAbgangEmail, buildKontaktBestaetigungEmail } = await import("./kontaktEmail.ts");
const { kontaktBestaetigungsLink, KONTAKT_BESTAETIGUNG_PATH } = await import("./kontaktLink.ts");
const { KONTAKT_EMAIL } = await import("./brand.ts");

const TOKEN = "abc123";
const FRIST = "05.10.2026";

const daten = {
  origin: ORIGIN,
  rollenText: "Ansprechperson",
  schule: "Ernst-Reuter-Schule",
  saisonId: "2627",
  token: TOKEN,
  fristText: FRIST,
  zeile: "offen" as const,
};

describe("the seat link this message spells", () => {
  it("puts the token on the origin it was handed, under the contact confirmation's path", () => {
    assert.equal(kontaktBestaetigungsLink(ORIGIN, TOKEN), `${ORIGIN}${KONTAKT_BESTAETIGUNG_PATH}?token=${TOKEN}`);
  });

  it("names a parameter the edge's own redaction map replaces", () => {
    assertRedactedAtTheEdge(kontaktBestaetigungsLink(ORIGIN, TOKEN));
  });

  /* The origin is normalised INSIDE the builder, which is what puts a trailing slash on
     `AUTH_URL` in front of `emailShell.test.ts`'s sweep rather than into a recipient's inbox. */
  it("normalises the origin before the link is spelled, not after", () => {
    const gebaut = buildKontaktBestaetigungEmail({ ...daten, origin: `${ORIGIN}/` });

    assert.ok(gebaut.html.includes(`${ORIGIN}${KONTAKT_BESTAETIGUNG_PATH}?token=`), "a configured trailing slash reaches the link");
  });

  it("escapes a token whose characters would otherwise end the query", () => {
    assert.equal(kontaktBestaetigungsLink(ORIGIN, "a b&c=d?e/f#g"), `${ORIGIN}${KONTAKT_BESTAETIGUNG_PATH}?token=a%20b%26c%3Dd%3Fe%2Ff%23g`);
  });

  /* The application's seat page answers this token too: a path of its own would be a page nobody serves. */
  it("lands on the page an application's seat opens", () => {
    assert.equal(KONTAKT_BESTAETIGUNG_PATH, "/bestaetigung/kontakt");
  });
});

describe("the message a seated contact person is mailed", () => {
  const mail = buildKontaktBestaetigungEmail(daten);

  it("carries the live link in both branches", () => {
    const url = kontaktBestaetigungsLink(ORIGIN, TOKEN);

    assert.ok(mail.html.includes(url), "the markup branch carries no link");
    assert.ok(mail.text.includes(url), "the text branch carries no link");
  });

  /* Both branches state the same facts: a reader whose client shows the text part must be told what
     the markup part tells the one beside them. No name: behind a typo, an unconfirmed address is a
     stranger's. */
  it("greets by no name and says who entered them, where and until when, in both branches", () => {
    for (const [branch, words] of [
      ["html", readable(mail.html)],
      ["text", flat(mail.text)],
    ] as const) {
      assert.match(words, /Hallo, die Verwaltung der Frankfurt League hat Dich/, `the ${branch} branch greets otherwise`);
      assert.match(
        words,
        /hat Dich in der Saison 2627 als Ansprechperson für Ernst-Reuter-Schule eingetragen\./,
        `the ${branch} branch names no seat or school`,
      );
      assert.match(words, /Saison 2627/, `the ${branch} branch names no season`);
      assert.ok(words.includes(FRIST), `the ${branch} branch names no deadline`);
      assert.match(words, /funktioniert nur einmal/, `the ${branch} branch does not say the link is one-time`);
    }
  });

  /* On screen „Zugang“ is an administrator's grant alone (`docs/glossary.md`); what a confirmed seat
     opens is named by the signed-in area's own name. */
  it("names the reader's area by its name, never a Zugang granted, in both branches", () => {
    for (const words of [readable(mail.html), flat(mail.text)]) {
      assert.ok(words.includes(`Erst danach findest Du Dein Team nach der Anmeldung auf der Website unter „${DEIN_BEREICH_TITEL}“.`), words);
      assert.doesNotMatch(words, /Zugang/);
    }
  });

  /* The link's two doors are named before the press: a person entered without asking has to know the
     page takes the entry away as readily as it confirms it. */
  it("names both answers the page offers, in both branches", () => {
    for (const words of [readable(mail.html), flat(mail.text)]) {
      assert.match(words, /bestätigst Du den Eintrag/);
      assert.match(words, /oder Du widersprichst ihm/);
    }
  });

  /* An administrator typed this address, so a reader who never agreed to be a contact person is told
     how the entry is taken away. */
  it("tells a reader who knows of no entry how to be taken off it", () => {
    for (const words of [readable(mail.html), flat(mail.text)]) {
      assert.match(words, /Du weißt nichts von diesem Eintrag\?/);
      assert.ok(words.includes(KONTAKT_EMAIL), "the escape route names no address");
    }
  });

  /* A contact person's first contact, and Art. 21(4) DSGVO asks the objection to reach them there apart
     from every other piece of information: a paragraph of its own in the card, a line group in the text. */
  it("states the objection in a paragraph of its own, in both parts", () => {
    assert.match(
      mail.html,
      /<p\b[^>]*>Der Verarbeitung Deiner Angaben kannst Du jederzeit aus Gründen widersprechen, die sich aus Deiner besonderen Situation ergeben \(Art\. 21 DSGVO\)\. Eine formlose E-Mail an <a href="mailto:[^"]+"[^>]*>[^<]+<\/a> genügt\.<\/p>/,
      "the card carries no objection of its own",
    );
    assert.match(mail.text, /\n\nDer Verarbeitung Deiner Angaben [^\n]+ genügt\.\n\n/, "the text part carries no objection of its own");
  });

  it("says on the subject line which seat at which school", () => {
    assert.equal(mail.subject, "Du bist als Ansprechperson für Ernst-Reuter-Schule eingetragen");
  });

  /* The subject is a header: a break typed into the school's name would end it and start another. */
  it("folds a multi-line value into one line in the subject and both branches", () => {
    const gefaltet = buildKontaktBestaetigungEmail({ ...daten, schule: "Schule\r\nBcc: x@y.de" });

    assert.ok(!/[\r\n]/.test(gefaltet.subject), "a typed newline reached the subject");
    assert.ok(!gefaltet.text.includes("Schule\r\nBcc"), "a typed newline reached the text branch");
    assert.match(flat(gefaltet.text), /für Schule Bcc: x@y\.de eingetragen\./);
  });

  it("escapes a school carrying markup rather than serving it", () => {
    const feindlich = buildKontaktBestaetigungEmail({ ...daten, schule: "<script>a</script>" });

    assert.ok(!feindlich.html.includes("<script>"), "the school reached the markup branch unescaped");
    assert.match(readable(feindlich.html), /für <script>a<\/script> eingetragen\./);
  });

  /* `fl_frontend/src/core/emailShell.ts :: mailOrigin` is what keeps a stack that is not production
     from mailing production links (`docs/frontend/spec.md :: I186`). */
  it("builds the link on the origin it was handed", () => {
    const fremd = buildKontaktBestaetigungEmail({ ...daten, origin: "https://beispiel.test" });

    assert.ok(fremd.html.includes(`https://beispiel.test${KONTAKT_BESTAETIGUNG_PATH}?token=${TOKEN}`));
    assert.ok(!fremd.text.includes(ORIGIN), "the text branch carries an origin nobody handed it");
  });
});

/* `docs/frontend/spec.md :: I89`: this message carries no column of facts, so every value the prose
   and the subject print is folded by its builder or by nothing. */
describe("no value can open a line of its own in the text part", () => {
  const FORGED_OPENER = "Startgeld: 500 Euro";
  const wert = `Wert\n${FORGED_OPENER}`;

  /** The builder with the break in each value it prints, one value at a time. */
  const faelle = (): { name: string; mail: { subject: string; text: string } }[] =>
    (["rollenText", "schule", "saisonId", "fristText"] as const).map((feld) => ({
      name: `the message's ${feld}`,
      mail: buildKontaktBestaetigungEmail({ ...daten, [feld]: wert }),
    }));

  it("folds every value the message prints onto one line, in the text part and the subject", () => {
    for (const { name, mail } of faelle()) {
      assert.ok(!mail.text.split("\n").some((line) => line.startsWith(FORGED_OPENER)), `${name} forged a line`);
      // Folded, never dropped: the seat, the school, the season and the deadline are what the reader confirms.
      assert.ok(mail.text.includes(`Wert ${FORGED_OPENER}`), `${name} was not carried onto one line`);
      assert.ok(!/[\r\n]/.test(mail.subject), `${name} put a break in the subject`);
    }
  });
});

/* `docs/frontend/spec.md :: I89`, for the leaving notice as for the confirmation: it prints the seats, the school and the
   season in its subject, its text and its markup, each a value somebody typed. */
describe("the leaving notice's values", () => {
  const FORGED_OPENER = "Startgeld: 500 Euro";
  const wert = `Wert\n${FORGED_OPENER}`;
  const abgang = { origin: ORIGIN, rollenText: "Ansprechperson", bleibtText: null, schule: "Ernst-Reuter-Schule", saisonId: "2627" };

  it("folds every value it prints onto one line, in the text part and the subject", () => {
    for (const [feld, daten] of [
      ["rollenText", { ...abgang, rollenText: wert }],
      ["bleibtText", { ...abgang, bleibtText: wert }],
      ["schule", { ...abgang, schule: wert }],
      ["saisonId", { ...abgang, saisonId: wert }],
    ] as const) {
      const mail = buildKontaktAbgangEmail(daten);

      assert.ok(!mail.text.split("\n").some((line) => line.startsWith(FORGED_OPENER)), `the notice's ${feld} forged a line`);
      assert.ok(mail.text.includes(`Wert ${FORGED_OPENER}`), `the notice's ${feld} was not carried onto one line`);
      assert.ok(!/[\r\n]/.test(mail.subject), `the notice's ${feld} put a break in the subject`);
    }
  });

  it("escapes a school or a seat carrying markup rather than serving it", () => {
    for (const daten of [
      { ...abgang, schule: "<script>a</script>" },
      { ...abgang, rollenText: "<script>a</script>", bleibtText: "Trainer" },
      { ...abgang, bleibtText: "<script>a</script>" },
    ]) {
      assert.ok(!buildKontaktAbgangEmail(daten).html.includes("<script>"), `a value reached the markup unescaped: ${JSON.stringify(daten)}`);
    }
  });
});

/* A closed row's link opens a page taking the Widerspruch alone, so a message asking for a confirmation
   sends its reader to a press that page does not have. */
describe("the message a person seated on a closed season row is mailed", () => {
  for (const [zeile, grund] of [
    ["saison_vorbei", "Die Saison ist vorbei, deshalb kannst Du den Eintrag nicht bestätigen."],
    ["ausgetreten", "Das Team spielt in dieser Saison nicht mehr mit, deshalb kannst Du den Eintrag nicht bestätigen."],
  ] as const) {
    it(`says why there is nothing to confirm and offers the Widerspruch alone, ${zeile}`, () => {
      const mail = buildKontaktBestaetigungEmail({ ...daten, zeile });

      for (const words of [readable(mail.html), flat(mail.text)]) {
        assert.ok(words.includes(grund), `the message does not say why the page takes no confirmation: ${words}`);
        assert.match(words, /Möchtest Du nicht eingetragen bleiben, kannst Du über den Link widersprechen\./);
        assert.ok(words.includes(FRIST), "the message names no deadline for the Widerspruch");
        assert.doesNotMatch(words, /Bitte bestätige|bestätigst Du|Eintrag bestätigen/, "the message asks for a confirmation the page refuses");
        // The re-send is refused on such a row, so the message promises none.
        assert.doesNotMatch(words, /schickt die Verwaltung Dir auf Wunsch einen neuen/);
      }
      assert.match(mail.html, />Zum Eintrag<\/a>/, "the control is named for a press the page does not offer");
    });
  }

  it("still asks an open row's person to confirm, with the control that says so", () => {
    const mail = buildKontaktBestaetigungEmail(daten);

    assert.match(flat(mail.text), /Bitte bestätige, dass das stimmt:/);
    assert.match(mail.html, />Eintrag bestätigen<\/a>/);
  });
});
