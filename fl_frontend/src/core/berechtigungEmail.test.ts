import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { registerDoubles } from "./exportingModule.ts";

registerDoubles();

const { buildAntragEndeEmail, buildBerechtigungEmail } = await import("./berechtigungEmail.ts");
const { ERASED_ACTOR_MARKER } = await import("./erasedActor.ts");

const ORIGIN = "http://localhost:3000";

/** Winter, so the instant is an hour off UTC: a formatter ignoring the zone would print 22:30. */
const AM = "2026-01-15T22:30:00Z";

const WARNSATZ = "Wenn Du diese Änderung nicht erwartet hast, melde Dich sofort bei den anderen Administratorinnen und Administratoren.";

describe("the notice a change to who administers sends", () => {
  it("names a grant, who made it and when, in the reader's own zone, in both parts", (t) => {
    // A runtime zone far from UTC: a stamp read in the runtime's zone would print another hour.
    const zone = process.env.TZ;
    process.env.TZ = "Pacific/Auckland";
    t.after(() => {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    });

    const mail = buildBerechtigungEmail(
      { art: "erteilt", adresse: "neu@schule.de", inhaber: false },
      { von: "vorstand@schule.de", am: AM },
      ORIGIN,
    );

    assert.equal(mail.subject, "Änderung beim Zugang zur Verwaltung der Frankfurt League");
    for (const part of [mail.text, mail.html]) {
      assert.ok(part.includes("neu@schule.de"), "the part does not name the address granted");
      assert.ok(part.includes("hat jetzt Zugang zur Verwaltung."));
      assert.ok(part.includes("Geändert von vorstand@schule.de am 15. Januar 2026"), "the part names nobody, or no German day");
      assert.ok(part.includes("23:30"), "the part dates the change in the server's zone");
      assert.ok(part.includes("Administratorinnen und Administratoren."), "the part drops what to do about an unexpected change");
    }
    assert.ok(mail.text.includes(`Zur Verwaltung: ${ORIGIN}/bereich/admin/administratoren`));
  });

  /* The case the notice exists for: a change nobody made in the application is one only a holder of
     the database's credentials can have made, and it must not read like an ordinary one. */
  it("says where a change made outside the application came from, naming nobody", () => {
    const mail = buildBerechtigungEmail({ art: "entzogen", adresse: "alt@schule.de", inhaber: false }, null, ORIGIN);

    assert.ok(mail.text.includes("alt@schule.de hat keinen Zugang zur Verwaltung mehr."));
    assert.ok(mail.text.includes("Diese Änderung wurde nicht in der Verwaltung vorgenommen, sondern direkt in der Datenbank."));
    assert.ok(!mail.text.includes("Geändert von"), "a change nobody in the application made names somebody");
    assert.ok(mail.text.includes(WARNSATZ));
  });

  /* A barred administrator's change is no database edit: told so, it would send every holder looking for a
     paste nobody made, and the notice never names a barred address. */
  it("names a barred administrator by their state, never as the database", () => {
    const mail = buildBerechtigungEmail({ art: "entzogen", adresse: "alt@schule.de", inhaber: false }, { von: null, am: AM }, ORIGIN);

    for (const part of [mail.text, mail.html]) {
      assert.ok(part.includes("Geändert von einer gesperrten Adresse am 15. Januar 2026"), "the withheld actor is not told as barred");
      assert.ok(!part.includes("direkt in der Datenbank"), "a barred administrator's change reads as a database edit");
    }
  });

  /* A barred address leaves the ban list on no route, the notice included. */
  it("names no address for a barred one, in either part", () => {
    const mail = buildBerechtigungEmail({ art: "erteilt", adresse: { vorenthalten: "gesperrt" }, inhaber: false }, null, ORIGIN);

    assert.ok(mail.text.includes("Eine gesperrte Adresse hat jetzt Zugang zur Verwaltung."));
    assert.ok(mail.html.includes("Eine gesperrte Adresse hat jetzt Zugang zur Verwaltung."));
  });

  /* The erasure's own notice: told as barred, every holder would read a ban nobody entered. */
  it("names an erased person's grant by no address and no ban, in each art and in either part", () => {
    const geloescht = { vorenthalten: "geloescht" } as const;
    const saetze = [
      [{ art: "entzogen", adresse: geloescht, inhaber: false }, "Eine nicht genannte Adresse hat keinen Zugang zur Verwaltung mehr."],
      [{ art: "erteilt", adresse: geloescht, inhaber: false }, "Eine nicht genannte Adresse hat jetzt Zugang zur Verwaltung."],
      [{ art: "geaendert", adresse: geloescht, inhaber: true }, "Eine nicht genannte Adresse ist jetzt Inhaberin oder Inhaber der Verwaltung."],
    ] as const;

    for (const [aenderung, satz] of saetze) {
      const mail = buildBerechtigungEmail(aenderung, { von: "vorstand@schule.de", am: AM }, ORIGIN);
      for (const part of [mail.text, mail.html]) {
        assert.ok(part.includes(satz), `the erased grant is not told as ${satz}`);
        assert.ok(!part.includes("gesperrt"), "an erased person's grant is told as barred");
      }
    }
  });

  /* The marker names nobody, and printed it would read as an address. */
  it("names an administrator erased since by no address and no ban, in either part", () => {
    const mail = buildBerechtigungEmail(
      { art: "erteilt", adresse: "neu@schule.de", inhaber: false },
      { von: ERASED_ACTOR_MARKER, am: AM },
      ORIGIN,
    );

    for (const part of [mail.text, mail.html]) {
      assert.ok(part.includes("Geändert von einer nicht genannten Adresse am 15. Januar 2026"), "the erased actor is not told neutrally");
      assert.ok(!part.includes(ERASED_ACTOR_MARKER), "the marker reached the notice");
      assert.ok(!part.includes("gesperrt"), "an erased administrator is told as barred");
    }
  });

  /* A request changes nobody's access: it is asked of its reader, under its own subject, and closes on what to do. */
  it("asks for a request's decision, naming who asked and when, for a grant and a promotion alike", () => {
    const zugang = buildBerechtigungEmail(
      { art: "beantragt", adresse: "neu@schule.de", inhaber: false },
      { von: "vorstand@schule.de", am: AM },
      ORIGIN,
    );
    const ernennung = buildBerechtigungEmail(
      { art: "beantragt", adresse: "kasse@schule.de", inhaber: true },
      { von: "vorstand@schule.de", am: AM },
      ORIGIN,
    );

    assert.equal(zugang.subject, "Antrag auf Zugang zur Verwaltung der Frankfurt League");
    for (const part of [zugang.text, zugang.html]) {
      assert.ok(part.includes("Für "), part);
      assert.ok(part.includes("neu@schule.de"));
      assert.ok(part.includes("ist ein Zugang zur Verwaltung beantragt."));
      assert.ok(part.includes("Beantragt von vorstand@schule.de am 15. Januar 2026"), "the part names nobody, or not as a request");
      assert.ok(part.includes("Genehmige oder lehne den Antrag in der Verwaltung"), "the part says not what to do");
      assert.ok(!part.includes("Geändert von"), "a request reads as a change made");
    }
    assert.ok(ernennung.text.includes("Für kasse@schule.de ist beantragt, Inhaberin oder Inhaber der Verwaltung zu werden."));
  });

  /* A promotion's subject already has access, so a subject asking for access tells its approvers something false. */
  it("heads, titles and closes a promotion's request as a promotion, never as a request for access", () => {
    const ernennung = buildBerechtigungEmail(
      { art: "beantragt", adresse: "kasse@schule.de", inhaber: true },
      { von: "vorstand@schule.de", am: AM },
      ORIGIN,
    );

    assert.equal(ernennung.subject, "Antrag auf Ernennung in der Verwaltung der Frankfurt League");
    for (const part of [ernennung.text, ernennung.html]) {
      assert.ok(part.includes("Antrag auf Ernennung zur Inhaberin oder zum Inhaber"), "the part is headed as a request for access");
      assert.ok(part.includes("dass die Person Inhaberin oder Inhaber werden soll."), "the part closes on access it already has");
      assert.ok(!part.includes("Zugang zur Verwaltung beantragt") && !part.includes("diesen Zugang"), "the part asks for access");
    }
  });

  /* An `owner` grant is the one a holder most needs told as such, whether an owner's address change moved it
     or the database wrote it. */
  it("names an `owner` grant as the owner's, barred or not", () => {
    const benannt = buildBerechtigungEmail({ art: "erteilt", adresse: "neu@schule.de", inhaber: true }, null, ORIGIN);
    const gesperrt = buildBerechtigungEmail({ art: "erteilt", adresse: { vorenthalten: "gesperrt" }, inhaber: true }, null, ORIGIN);

    for (const part of [benannt.text, benannt.html]) {
      assert.ok(part.includes("hat jetzt Zugang zur Verwaltung als Inhaberin oder Inhaber."));
    }
    assert.ok(benannt.text.includes("neu@schule.de hat jetzt Zugang zur Verwaltung als Inhaberin oder Inhaber."));
    assert.ok(gesperrt.text.includes("Eine gesperrte Adresse hat jetzt Zugang zur Verwaltung als Inhaberin oder Inhaber."));
  });

  it("names the tier a change in the database moved, either way", () => {
    const hoch = buildBerechtigungEmail({ art: "geaendert", adresse: "a@schule.de", inhaber: true }, null, ORIGIN);
    const runter = buildBerechtigungEmail({ art: "geaendert", adresse: "a@schule.de", inhaber: false }, null, ORIGIN);

    assert.ok(hoch.text.includes("a@schule.de ist jetzt Inhaberin oder Inhaber der Verwaltung."));
    assert.ok(runter.text.includes("a@schule.de ist nicht mehr Inhaberin oder Inhaber der Verwaltung und behält den Zugang."));
  });

  /* An erasure ends an `owner` grant with no demotion before it, so the end is the one notice the remaining
     holders are sent of it, and read as any administrator's it hides that the tier left. */
  it("names an `owner` grant's end as an owner's, named, barred or erased", () => {
    const enden = (adresse: string | { vorenthalten: "gesperrt" | "geloescht" }): string =>
      buildBerechtigungEmail({ art: "entzogen", adresse: adresse, inhaber: true }, null, ORIGIN).text;

    assert.ok(enden("a@schule.de").includes("a@schule.de ist nicht mehr Inhaberin oder Inhaber der Verwaltung und hat keinen Zugang mehr."));
    assert.ok(enden({ vorenthalten: "gesperrt" }).includes("Eine gesperrte Adresse ist nicht mehr Inhaberin oder Inhaber der Verwaltung"));
    assert.ok(
      enden({ vorenthalten: "geloescht" }).includes("Eine nicht genannte Adresse ist nicht mehr Inhaberin oder Inhaber der Verwaltung"),
    );
  });

  /* People of either gender hold the `owner` tier, so no sentence names it by the masculine word alone. */
  it("never names the `owner` tier by the masculine word alone, in any art or part", () => {
    for (const art of ["erteilt", "geaendert", "entzogen"] as const) {
      for (const inhaber of [true, false]) {
        const mail = buildBerechtigungEmail({ art: art, adresse: "a@schule.de", inhaber: inhaber }, null, ORIGIN);
        for (const part of [mail.text, mail.html]) {
          assert.ok(!part.replaceAll("Inhaberin oder Inhaber", "").includes("Inhaber"), `${art}, owner ${String(inhaber)}: ${part}`);
        }
      }
    }
  });

  /* The provider collapses a repeat under one key only where the body is the same byte for byte, so a
     body carrying the moment of its send would be refused as a changed request on the second pass. */
  it("composes the same message for the same change whenever it is built", async (t) => {
    const aenderung = { art: "erteilt", adresse: "neu@schule.de", inhaber: false } as const;
    const urheber = { von: "vorstand@schule.de", am: AM };

    t.mock.timers.enable({ apis: ["Date"], now: 0 });
    const frueh = buildBerechtigungEmail(aenderung, urheber, ORIGIN);
    t.mock.timers.tick(60 * 60 * 1000);
    const spaet = buildBerechtigungEmail(aenderung, urheber, ORIGIN);

    assert.deepEqual(spaet, frueh);
  });

  it("escapes an address in the markup", () => {
    const mail = buildBerechtigungEmail({ art: "erteilt", adresse: "<b>@schule.de", inhaber: false }, { von: "a&b@schule.de", am: AM }, ORIGIN);

    assert.ok(!mail.html.includes("<b>@schule.de"), "the markup carries the address unescaped");
    assert.ok(mail.html.includes("&lt;b&gt;@schule.de"));
    assert.ok(mail.html.includes("a&amp;b@schule.de"));
  });
});

/* `docs/backend/spec.md :: I865`: a request's end is told to its requester under the request's own subject, naming the
   address they asked about and nobody who acted. */
describe("the notice a request's end sends its requester", () => {
  it("tells a grant's refusal under the request's subject, naming the address asked about, in both parts", () => {
    const mail = buildAntragEndeEmail({ art: "antrag_abgelehnt", adresse: "neu@schule.de", inhaber: false }, ORIGIN);

    assert.equal(mail.subject, "Antrag auf Zugang zur Verwaltung der Frankfurt League");
    assert.ok(mail.text.includes("Dein Antrag auf Zugang zur Verwaltung für neu@schule.de wurde abgelehnt."), mail.text);
    assert.ok(mail.html.includes("Dein Antrag auf Zugang zur Verwaltung für <strong"), "the markup does not mark the address");
    assert.ok(mail.text.includes(`Zur Verwaltung: ${ORIGIN}/bereich/admin/administratoren`));
    for (const part of [mail.text, mail.html]) {
      // Nobody who acted: the builder is handed nobody, and no line says who did it.
      assert.ok(!/(Beantragt|Geändert|abgelehnt) von/.test(part), `the part names somebody: ${part}`);
      assert.ok(!part.includes("Genehmige"), "the part asks its reader to decide a request that has ended");
    }
  });

  it("tells an address change's end and a promotion's, each in its own words", () => {
    const beendet = buildAntragEndeEmail({ art: "antrag_beendet", adresse: "neu@schule.de", inhaber: false }, ORIGIN);
    const ernennung = buildAntragEndeEmail({ art: "antrag_abgelehnt", adresse: "kasse@schule.de", inhaber: true }, ORIGIN);
    const ernennungBeendet = buildAntragEndeEmail({ art: "antrag_beendet", adresse: "kasse@schule.de", inhaber: true }, ORIGIN);

    assert.ok(beendet.text.includes("Dein Antrag auf Zugang zur Verwaltung für neu@schule.de endete, weil sich die Adresse geändert hat."));
    assert.equal(ernennung.subject, "Antrag auf Ernennung in der Verwaltung der Frankfurt League");
    assert.ok(
      ernennung.text.includes("Dein Antrag, kasse@schule.de zur Inhaberin oder zum Inhaber der Verwaltung zu ernennen, wurde abgelehnt."),
    );
    assert.ok(
      ernennungBeendet.text.includes(
        "Dein Antrag, kasse@schule.de zur Inhaberin oder zum Inhaber der Verwaltung zu ernennen, endete, weil sich die Adresse geändert hat.",
      ),
    );
  });

  it("names a withheld address by its state inside the sentence, never the address", () => {
    const gesperrt = buildAntragEndeEmail({ art: "antrag_abgelehnt", adresse: { vorenthalten: "gesperrt" }, inhaber: false }, ORIGIN);
    const geloescht = buildAntragEndeEmail({ art: "antrag_beendet", adresse: { vorenthalten: "geloescht" }, inhaber: true }, ORIGIN);

    assert.ok(gesperrt.text.includes("Dein Antrag auf Zugang zur Verwaltung für eine gesperrte Adresse wurde abgelehnt."));
    assert.ok(geloescht.text.includes("Dein Antrag, eine nicht genannte Adresse zur Inhaberin oder zum Inhaber der Verwaltung zu ernennen,"));
  });

  it("escapes the address in the markup and folds it onto one line in the text", () => {
    const markup = buildAntragEndeEmail({ art: "antrag_abgelehnt", adresse: "<b>@schule.de", inhaber: false }, ORIGIN);
    const gebrochen = buildAntragEndeEmail({ art: "antrag_abgelehnt", adresse: "Wert\nStartgeld: 500 Euro", inhaber: false }, ORIGIN);

    assert.ok(!markup.html.includes("<b>@schule.de") && markup.html.includes("&lt;b&gt;@schule.de"));
    assert.ok(!gebrochen.text.split("\n").some((line) => line.startsWith("Startgeld")), "the address forged a line");
  });
});

/* `docs/frontend/spec.md :: I89`: this notice carries no column of facts, so every value its prose
   prints is folded by its builder or by nothing. */
describe("no value can open a line of its own in the text part", () => {
  const FORGED_OPENER = "Startgeld: 500 Euro";
  const wert = `Wert\n${FORGED_OPENER}`;

  /** The builder with the break in each value it prints, one value at a time. */
  const faelle = (): { name: string; mail: { subject: string; text: string } }[] => [
    {
      name: "the grant's address",
      mail: buildBerechtigungEmail({ art: "erteilt", adresse: wert, inhaber: false }, { von: "vorstand@schule.de", am: AM }, ORIGIN),
    },
    {
      name: "the acting administrator",
      mail: buildBerechtigungEmail({ art: "erteilt", adresse: "neu@schule.de", inhaber: false }, { von: wert, am: AM }, ORIGIN),
    },
  ];

  it("folds every value the notice prints onto one line, in the text part and the subject", () => {
    for (const { name, mail } of faelle()) {
      assert.ok(!mail.text.split("\n").some((line) => line.startsWith(FORGED_OPENER)), `${name} forged a line`);
      // Folded, never dropped: the address is what the notice is about.
      assert.ok(mail.text.includes(`Wert ${FORGED_OPENER}`), `${name} was not carried onto one line`);
      assert.ok(!/[\r\n]/.test(mail.subject), `${name} put a break in the subject`);
    }
  });
});
