import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
      einwilligung: { umfang: "kontaktdaten", erfasst_von: "person", text_version: "2026-08", datum: "2026-08-01", bestaetigt_am: null },
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

  /* An acceptance writes the created club's id back onto the application, so a decided new-school
     application carries a school AND a club. A guard on the school arm drops the link on exactly
     those. */
  it("links the club a decided application was entered into, although it names a school too", () => {
    const row = factLine(markup(), "Team");

    assert.match(row, new RegExp(`<a[^>]*href="/admin/teams/${TEAM_ID}\\?saison_id=2026"`), "the club the acceptance created is not linked");
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

  /* The floor under the sink assertion in `fl_frontend/src/features/bewerbungen/routes.test.ts`: a
     panel that had stopped rendering the applicant's words would satisfy that one by rendering none. */
  it("renders the wished opponent as element content", () => {
    assert.equal(textOf(factLine(markup(), "Wunschgegner")), "Helmholtzschule");
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
