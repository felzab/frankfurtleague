import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { publishedFassung } from "@/core/einwilligungDocument.ts";
import { ERASED_ACTOR_MARKER } from "@/core/erasedActor.ts";
import { GELOESCHTE_PERSON, GESPERRTE_ADRESSE } from "@/features/berechtigungen/constants.ts";
import { kenntnisnahme } from "@/shared/testing/kenntnisnahme.ts";
import { assertLeerMarkup } from "@/shared/testing/leerGrade.ts";
import { renderMarkup, textOf } from "@/shared/testing/renderTest";

import { FLBewerbungSchema } from "../../schemas.ts";

import type { MedienFragen } from "@/features/spieler/nachweis.ts";
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
      einwilligung: kenntnisnahme({ text_version: "2026-08", datum: "2026-08-01", bestaetigt_am: null }),
    },
    stellvertretung: null,
    trainer: null,
    trainer_ist_zugleich: null,
  },
  trikot: { vorhandener_satz: "Zwei Sätze", wunschfarbe: "rot" },
  kader: { voraussichtliche_groesse: 14, gute_spieler: 2 },
  stufengroesse: 96,
  wunschgegner: "Helmholtzschule",
  entscheidung: null,
  bestaetigungen: { trainer: null, ansprechperson: null, stellvertretung: null },
  bestaetigungsfrist: "2026-05-15",
} satisfies FLBewerbung);

/** Whether each label's page asked the media choice, off the registry's words as the page reads them. */
const fragenOf = (...labels: string[]): MedienFragen =>
  Object.fromEntries(labels.map((label) => [label, Object.hasOwn(publishedFassung(label).bedienelemente, "medien")]));

const markup = (fields: Partial<FLBewerbung> = {}, teamName: string | null = TEAM_NAME, medienFragen: MedienFragen = {}): string =>
  renderMarkup(BewerbungAngabenPanel, { bewerbung: { ...BEWERBUNG, ...fields }, teamName, staende: [], medienFragen });

/** One fact's value, cut from the `<dd>` under its own `<dt>`: the same words stand in several rows. */
const factLine = (html: string, label: string): string => new RegExp(`<dt[^>]*>${label}</dt><dd[^>]*>(.*?)</dd>`, "s").exec(html)?.[1] ?? "";

/** A contact page's label from before it asked the media choice, and one from after. */
const VOR_DER_FRAGE = "2026-09-bestaetigungsseite-6";
const MIT_DER_FRAGE = "2026-10-bestaetigungsseite-7";

/** The pending application, its seat confirmed on `textVersion` with no evidence of either choice, as the page hands it. */
function mitBestaetigung(textVersion: string, bestaetigtAm: string): string {
  const ansprechperson = BEWERBUNG.kontakte.ansprechperson;
  assert.ok(ansprechperson !== null);
  const einwilligung = {
    ...ansprechperson.einwilligung,
    text_version: textVersion,
    bestaetigt_am: bestaetigtAm,
    nachweis: { umfang: null, medien: null },
  };

  return markup(
    { status: "eingereicht", kontakte: { ...BEWERBUNG.kontakte, ansprechperson: { ...ansprechperson, einwilligung } } },
    TEAM_NAME,
    fragenOf(textVersion),
  );
}

describe("the panel a triage decision is taken from", () => {
  /* First: a cut the panel's markup does not answer leaves every assertion below reading an empty
     string, which the absence assertions would then pass on. */
  it("renders the club row as a fact under its own label", () => {
    assert.notEqual(factLine(markup(), "Team"), "", "no fact stands under „Team“ at all");
  });

  /* The form never asks a contact's birthdate; it arrives with their confirmation, so until then the
     step is theirs, and only a confirmed seat without one holds an empty field. */
  for (const [bestaetigtAm, worte] of [
    [null, "Trägt die Person selbst ein"],
    ["2026-08-03", "Nicht hinterlegt"],
  ] as const) {
    it(`reads a missing birthdate on a seat confirmed ${bestaetigtAm ?? "never"} as „${worte}“, as the contacts editor does`, () => {
      const ansprechperson = BEWERBUNG.kontakte.ansprechperson;
      assert.ok(ansprechperson !== null);
      const person = { ...ansprechperson, geburtsdatum: null, einwilligung: { ...ansprechperson.einwilligung, bestaetigt_am: bestaetigtAm } };
      const html = markup({ kontakte: { ...BEWERBUNG.kontakte, ansprechperson: person } });

      assert.equal(textOf(factLine(html, "Geburtsdatum")), worte);
      assertLeerMarkup(factLine(html, "Geburtsdatum"), worte);
    });
  }

  it("reads a field the school left empty as not held", () => {
    assert.equal(textOf(factLine(markup({ wunschgegner: null }), "Wunschgegner")), "Nicht hinterlegt");
  });

  /* The Herkunft is who seated the person, `eingetragen_von`. */
  for (const [von, label] of [
    ["bewerbung", "Mit der Bewerbung eingetragen"],
    ["liga", "Von der Liga eingetragen"],
  ] as const) {
    it(`names a seat stored as ${von} by who seated it, „${label}“`, () => {
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

  /* A seat confirmed before choices carried their own evidence stands on its confirmation alone, where its page asked. */
  it("reads a confirmed seat's choice with no evidence of its own as standing on the confirmation", () => {
    const html = mitBestaetigung(MIT_DER_FRAGE, "2026-10-13");

    assert.ok(
      textOf(factLine(html, "Medien")).endsWith(`seit der Bestätigung am 13.10.2026, Fassung ${MIT_DER_FRAGE}`),
      textOf(factLine(html, "Medien")),
    );
  });

  /* A seat kept through the reset from a page that never asked the media choice holds the "false" the server wrote for
     it: filed against the confirmation, the readout would present a choice nobody was offered as the person's own. */
  it("reads a media choice the confirmed seat's page never asked as not asked", () => {
    const medien = textOf(factLine(mitBestaetigung(VOR_DER_FRAGE, "2026-09-20"), "Medien"));

    assert.ok(medien.endsWith(`Bei der Bestätigung am 20.09.2026 nicht gefragt (Fassung ${VOR_DER_FRAGE})`), medien);
    assert.ok(!medien.includes("seit der Bestätigung"), "the choice is filed against a confirmation that never asked it");
  });

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

  it("shows the cohort size the school stated", () => {
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
    assertLeerMarkup(markup({ entscheidung: { getroffen_am: "2026-09-10", von: null, von_gesperrt: true, grund: null } }), GESPERRTE_ADRESSE);
  });

  /* An erasure leaves a marker naming nobody in the decider's place: printed, it reads as an address, and
     past the panel's own "System" arm it must reach the shared words. */
  it("names an administrator erased since by that state, and never as barred", () => {
    assert.equal(entschieden(ERASED_ACTOR_MARKER, false), GELOESCHTE_PERSON);
    assertLeerMarkup(
      markup({ entscheidung: { getroffen_am: "2026-09-10", von: ERASED_ACTOR_MARKER, von_gesperrt: false, grund: null } }),
      GELOESCHTE_PERSON,
    );
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
