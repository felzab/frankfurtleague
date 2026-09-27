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

const { buildBerechtigungEmail } = await import("./berechtigungEmail.ts");

const ORIGIN = "http://localhost:3000";

/** Winter, so the instant is an hour off UTC: a formatter ignoring the zone would print 22:30. */
const AM = "2026-01-15T22:30:00Z";

const WARNSATZ = "Wenn Du diese Änderung nicht erwartet hast, melde Dich sofort bei den anderen Administratorinnen und Administratoren.";

describe("the notice a change to who administers sends", () => {
  it("names a grant, who made it and when, in the reader's own zone, in both parts", () => {
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
    const mail = buildBerechtigungEmail({ art: "entzogen", adresse: "alt@schule.de" }, null, ORIGIN);

    assert.ok(mail.text.includes("alt@schule.de hat keinen Zugang zur Verwaltung mehr."));
    assert.ok(mail.text.includes("Diese Änderung wurde nicht in der Verwaltung vorgenommen, sondern direkt in der Datenbank."));
    assert.ok(!mail.text.includes("Geändert von"), "a change nobody in the application made names somebody");
    assert.ok(mail.text.includes(WARNSATZ));
  });

  /* A barred address leaves the ban list on no route, the notice included. */
  it("names no address for a barred one, in either part", () => {
    const mail = buildBerechtigungEmail({ art: "erteilt", adresse: null, inhaber: false }, null, ORIGIN);

    assert.ok(mail.text.includes("Eine gesperrte Adresse hat jetzt Zugang zur Verwaltung."));
    assert.ok(mail.html.includes("Eine gesperrte Adresse hat jetzt Zugang zur Verwaltung."));
  });

  /* The application grants no `owner`, so one is a change in the database, and the one a holder most
     needs told as such. */
  it("names an `owner` grant as the owner's, barred or not", () => {
    const benannt = buildBerechtigungEmail({ art: "erteilt", adresse: "neu@schule.de", inhaber: true }, null, ORIGIN);
    const gesperrt = buildBerechtigungEmail({ art: "erteilt", adresse: null, inhaber: true }, null, ORIGIN);

    for (const part of [benannt.text, benannt.html]) assert.ok(part.includes("hat jetzt Zugang zur Verwaltung als Inhaber."));
    assert.ok(benannt.text.includes("neu@schule.de hat jetzt Zugang zur Verwaltung als Inhaber."));
    assert.ok(gesperrt.text.includes("Eine gesperrte Adresse hat jetzt Zugang zur Verwaltung als Inhaber."));
  });

  it("names the tier a change in the database moved, either way", () => {
    const hoch = buildBerechtigungEmail({ art: "geaendert", adresse: "a@schule.de", inhaber: true }, null, ORIGIN);
    const runter = buildBerechtigungEmail({ art: "geaendert", adresse: "a@schule.de", inhaber: false }, null, ORIGIN);

    assert.ok(hoch.text.includes("a@schule.de ist jetzt Inhaber der Verwaltung."));
    assert.ok(runter.text.includes("a@schule.de ist nicht mehr Inhaber der Verwaltung und behält den Zugang."));
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
