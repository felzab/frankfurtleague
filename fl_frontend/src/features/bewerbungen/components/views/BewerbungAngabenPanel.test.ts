import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GESPERRTE_ADRESSE } from "@/features/berechtigungen/constants.ts";
import { kenntnisnahme } from "@/shared/testing/kenntnisnahme.ts";
import { renderMarkup, textOf } from "@/shared/testing/renderTest";

import { FLBewerbungSchema } from "../../schemas.ts";

import type { FLBewerbung } from "../../schemas.ts";

/* Reached after the harness above has evaluated, which is when the JSX compile step is registered: a
   static import beside it resolves first and dies on the extension. */
const { BewerbungAngabenPanel } = await import("./BewerbungAngabenPanel.tsx");

const TEAM_ID = "6890a1b2c3d4e5f607181002";
const TEAM_NAME = "Goethe-Gymnasium";

/**
 * An accepted application from a NEW school, which is the state carrying a school block and a club
 * at once. Complete and parsed at construction: a drifted field fails here rather than in the markup.
 */
const BEWERBUNG: FLBewerbung = FLBewerbungSchema.parse({
  id: "6890a1b2c3d4e5f607181001",
  saison_id: "2026",
  eingereicht_am: "2026-05-04",
  status: "angenommen",
  team_id: TEAM_ID,
  schule: {
    team_name: "Goethe",
    full_name: TEAM_NAME,
    shorthand: "GG",
    schulform: "gymnasium_g8",
    address: { strasse: "Feldweg", hausnummer: "3", plz: "60325", stadtteil: "Westend", stadt: "Frankfurt" },
    website_url: null,
  },
  kontakte: {
    ansprechperson: {
      vorname: "Erika",
      nachname: "Mustermann",
      email: "erika@beispiel.invalid",
      // Spaced the way a school types one, which is the whole of what the two hrefs differ over.
      telefon: "069 12 34 56",
      geburtsdatum: "1990-01-01",
      einwilligung: kenntnisnahme({ erfasst_von: "person", text_version: "2026-08", datum: "2026-08-01", bestaetigt_am: null }),
    },
    stellvertretung: null,
    trainer: null,
    trainer_ist_zugleich: null,
  },
  trikot: { vorhandener_satz: "Zwei Sätze", wunschfarbe: null },
  kader: { voraussichtliche_groesse: 14, gute_spieler: 2 },
  stufengroesse: 96,
  wunschgegner: "Helmholtzschule",
  entscheidung: null,
  bestaetigungen: null,
  bestaetigungsfrist: null,
} satisfies FLBewerbung);

const markup = (fields: Partial<FLBewerbung> = {}, teamName: string | null = TEAM_NAME): string =>
  renderMarkup(BewerbungAngabenPanel, { bewerbung: { ...BEWERBUNG, ...fields }, teamName, staende: null });

/** One fact's value, cut from the `<dd>` under its own `<dt>`: the same words stand in several rows. */
const factLine = (html: string, label: string): string => new RegExp(`<dt[^>]*>${label}</dt><dd[^>]*>(.*?)</dd>`, "s").exec(html)?.[1] ?? "";

describe("the panel a triage decision is taken from", () => {
  /* First: a cut the panel's markup does not answer leaves every assertion below reading an empty
     string, which the absence assertions would then pass on. */
  it("renders the club row as a fact under its own label", () => {
    assert.notEqual(factLine(markup(), "Team"), "", "no fact stands under „Team“ at all");
  });

  /* The form never asks a contact's birthdate; it arrives with their confirmation, so an empty one is a
     fact the league holds nothing for yet, never a field the school left empty. */
  it("reads a contact's missing birthdate as not held, and a field the school left empty as not given", () => {
    const ansprechperson = BEWERBUNG.kontakte.ansprechperson;
    assert.ok(ansprechperson !== null);
    const html = markup({ wunschgegner: null, kontakte: { ...BEWERBUNG.kontakte, ansprechperson: { ...ansprechperson, geburtsdatum: null } } });

    assert.equal(textOf(factLine(html, "Geburtsdatum")), "Nicht hinterlegt");
    assert.equal(textOf(factLine(html, "Wunschgegner")), "Nicht hinterlegt");
  });

  /* The Herkunft is who seated the person, `eingetragen_von`: `erfasst_von` is written by nothing new
     and leaves the stored records at the programme's end, so a label read off it would go blank. */
  for (const [von, label] of [
    ["bewerbung", "Mit der Bewerbung eingetragen"],
    ["liga", "Von der Liga eingetragen"],
    [null, "Herkunft nicht hinterlegt"],
  ] as const) {
    it(`names a seat stored as ${String(von)} by who seated it, „${label}“`, () => {
      const ansprechperson = BEWERBUNG.kontakte.ansprechperson;
      assert.ok(ansprechperson !== null);
      const html = markup({
        kontakte: {
          ...BEWERBUNG.kontakte,
          ansprechperson: { ...ansprechperson, einwilligung: { ...ansprechperson.einwilligung, eingetragen_von: von } },
        },
      });

      assert.match(textOf(factLine(html, "Kenntnisnahme")), new RegExp(`^${label}, `));
    });
  }

  /* Withdrawable on the account page while the application is pending, so the administrator deciding it
     reads both as they stand, each with its act; both arms, so „erlaubt“ for every seat fails. */
  for (const [umfang, medien, whatsappWorte, medienWorte] of [
    ["kontaktdaten_whatsapp", true, "erlaubt", "Fotos, Videos und Interviews zugesagt"],
    ["kontaktdaten", false, "nicht erlaubt", "Nicht zugesagt"],
  ] as const) {
    it(`reads out a pending seat's WhatsApp scope „${whatsappWorte}“ and media consent „${medienWorte}“, each with its act`, () => {
      const ansprechperson = BEWERBUNG.kontakte.ansprechperson;
      assert.ok(ansprechperson !== null);
      const html = markup({
        status: "eingereicht",
        kontakte: {
          ...BEWERBUNG.kontakte,
          ansprechperson: {
            ...ansprechperson,
            einwilligung: {
              ...ansprechperson.einwilligung,
              umfang: umfang,
              medien: medien,
              bestaetigt_am: "2026-08-02",
              nachweis: { umfang: { am: "2026-08-02T08:00:00+00:00", text_version: "2026-08", erteilt_zuvor: null }, medien: null },
            },
          },
        },
      });

      assert.ok(textOf(factLine(html, "WhatsApp"), " ").startsWith(`${whatsappWorte} `), textOf(factLine(html, "WhatsApp"), " "));
      assert.ok(textOf(factLine(html, "Medien")).startsWith(medienWorte), textOf(factLine(html, "Medien")));
      assert.notEqual(textOf(factLine(html, "WhatsApp")), whatsappWorte, "the WhatsApp scope stands on no act");
    });
  }

  /* A decided application's copy is frozen: the seats' choices move on the team's row from then on, so
     the copy read out in the present tense would contradict them for as long as it is kept. */
  for (const status of ["angenommen", "abgelehnt"] as const) {
    it(`reads out no choice on an application ${status}`, () => {
      const html = markup({ status: status });

      assert.equal(factLine(html, "WhatsApp"), "", "a decided application reads out a frozen WhatsApp scope");
      assert.equal(factLine(html, "Medien"), "", "a decided application reads out a frozen media consent");
    });
  }

  /* An acceptance writes the created club's id back onto the application, so a decided new-school
     application carries a school AND a club. A guard on the school arm drops the link on exactly
     those. */
  it("links the club a decided application was entered into, although it names a school too", () => {
    const row = factLine(markup(), "Team");

    assert.match(
      row,
      new RegExp(`<a[^>]*href="/bereich/admin/teams/${TEAM_ID}\\?saison_id=2026"`),
      "the club the acceptance created is not linked",
    );
    assert.equal(textOf(row), TEAM_NAME);
  });

  /* The other side of the same guard, or a link asserted everywhere proves nothing about the id it
     is read off: a club nothing has entered the application into has no page to open. */
  it("names the club as text while the application has been entered into none", () => {
    const row = factLine(markup({ team_id: null }), "Team");

    assert.doesNotMatch(row, /<a[\s>]/, "an application carrying no club id still offers a club page");
    assert.equal(textOf(row), TEAM_NAME);
  });

  it("takes the empty grade where no club stands behind the application at all", () => {
    assert.equal(textOf(factLine(markup({}, null), "Team")), textOf(factLine(markup({ wunschgegner: null }), "Wunschgegner")));
  });

  it("writes the stored address into a mailto: link", () => {
    const row = factLine(markup(), "E-Mail");

    assert.match(row, /href="mailto:erika@beispiel\.invalid"/, "the address is not offered as a link");
    assert.equal(textOf(row), "erika@beispiel.invalid");
  });

  /* The dialler takes a number with nothing in it to parse; the reader takes the grouping the school
     typed, which is what makes a wrong digit visible. */
  it("dials the number with its whitespace out and shows it with the whitespace in", () => {
    const row = factLine(markup(), "Telefon");

    assert.match(row, /href="tel:069123456"/, "the dialler is handed the spacing a school typed");
    assert.equal(textOf(row), "069 12 34 56", "the number is shown stripped rather than as it was typed");
  });

  /* A `null` here is a school that answered nothing rather than one that answered zero, and the panel
     has one grade for that: compared against a second unanswered row, so neither reads as a blank cell. */
  it("gives an unanswered number the panel's one empty grade", () => {
    const unanswered = factLine(markup({ stufengroesse: null }), "Größe der Stufe");

    assert.notEqual(unanswered, "", "the row a school left empty renders as nothing at all");
    assert.equal(unanswered, factLine(markup({ wunschgegner: null }), "Wunschgegner"), "two unanswered rows carry two different grades");
    assert.equal(textOf(factLine(markup(), "Größe der Stufe")), "96");
  });

  /* Applicant-controlled and read by an administrator. As element CONTENT React escapes it; in an
     attribute it is an `href` or a `srcDoc` away from executing, and as raw markup it runs. */
  it("renders the wished opponent as escaped element content, in no attribute", () => {
    const html = markup({ wunschgegner: "Zorbanax <b>Schule</b>" });

    assert.equal(textOf(factLine(html, "Wunschgegner")), "Zorbanax &lt;b&gt;Schule&lt;/b&gt;", "the applicant's markup is rendered raw");
    assert.deepEqual(
      [...html.matchAll(/<[^>]*>/g)].filter(([tag]) => tag.includes("Zorbanax")),
      [],
      "the wished opponent reaches an attribute",
    );
  });
});

describe("who the panel says decided", () => {
  const entschieden = (von: string | null, vonGesperrt: boolean): string =>
    textOf(factLine(markup({ entscheidung: { getroffen_am: "2026-09-10", von, von_gesperrt: vonGesperrt, grund: null } }), "Von"));

  /* First: a cut the markup does not answer reads as the empty string, which the withheld case would
     otherwise fail on for the wrong reason. */
  it("names the administrator by the address", () => {
    assert.equal(entschieden("admin@beispiel.invalid", false), "admin@beispiel.invalid");
  });

  /* The read serves a barred administrator as `null` beside the flag (`docs/frontend/spec.md :: I492`). */
  it("names an administrator the ban list holds by that state", () => {
    assert.equal(entschieden(null, true), GESPERRTE_ADRESSE);
  });
});

/** The first panel's heading, which is where the panel says which of the two the application is. */
const firstTitle = (html: string): string => textOf(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/s.exec(html)?.[1] ?? "").trim();

describe("which of the two the panel says an application is", () => {
  /* First: a heading the cut cannot find reads as the empty string, which the absences below pass on. */
  it("heads a proposed school as a new school, although acceptance has named its club", () => {
    assert.equal(firstTitle(markup()), "Neue Schule");
  });

  it("heads a picked club as one already in the league, and says acceptance only enters it", () => {
    const html = markup({ schule: null });

    assert.equal(firstTitle(html), "Bestehendes Team");
    assert.equal(textOf(factLine(html, "Angaben zum Team")), "Das Team ist schon angelegt und wird bei einer Zusage nur aufgenommen.");
  });

  /* The row `REQ-BEWERBUNG-002` refuses. Headed as a club, it tells the administrator a club exists
     and that acceptance only enters it, both of which are false. */
  it("claims neither where the application names neither, and says so", () => {
    const html = markup({ schule: null, team_id: null }, null);

    assert.notEqual(firstTitle(html), "", "the panel renders no heading to read");
    assert.ok(!["Bestehendes Team", "Neue Schule"].includes(firstTitle(html)), `the panel is headed „${firstTitle(html)}“`);
    assert.equal(textOf(factLine(html, "Angaben zum Team")), "Die Bewerbung nennt weder eine neue Schule noch ein bestehendes Team.");
  });
});
