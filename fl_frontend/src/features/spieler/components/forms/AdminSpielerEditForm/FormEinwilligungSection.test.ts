import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readEinwilligungDocument } from "@/core/einwilligungDocument.ts";
import { assertLeerMarkup } from "@/shared/testing/leerGrade.ts";
import { renderMarkup, textOf } from "@/shared/testing/renderTest";

import { EINWILLIGUNG_MEDIEN_LABELS, EINWILLIGUNG_UMFANG_LABELS, EINWILLIGUNG_VEROEFFENTLICHUNG_HINWEIS } from "../../../constants.ts";

import type { FLEinwilligung } from "../../../schemas.ts";

/* Reached after the harness above has evaluated, which is when the JSX compile step is registered: a
   static import beside it resolves first and dies on the extension. */
const { FormEinwilligungSection } = await import("./FormEinwilligungSection.tsx");

/** A label the backend's registry holds, which is the branch a stored record is meant to take. */
const FASSUNG = "2026-09-bestaetigung-3";

/** A label it answers with nothing — what a record stamped under a wording since removed would carry. */
const UNBEKANNTE_FASSUNG = "liga-2019-01-erfunden";

/** Each choice as its person's own confirmation evidences it, at that press under its label. */
const BESTAETIGUNG = { am: "2026-03-04T09:00:00Z", text_version: FASSUNG, erteilt_zuvor: null };

/** A consent the registration flow collected: dated, confirmed, and citing the wording its person was shown. */
const ERTEILT: FLEinwilligung = {
  umfang: "kader_oeffentlich",
  datum: "2026-03-04",
  bestaetigt_am: "2026-03-04",
  text_version: FASSUNG,
  medien: true,
  nachweis: { umfang: BESTAETIGUNG, medien: BESTAETIGUNG },
};

/** The same record with its media consent withheld. */
const OHNE_MEDIEN: FLEinwilligung = { ...ERTEILT, medien: false };

/** The panel as the page hands it over, which resolves the stored label through the words read. */
const markup = (einwilligung: FLEinwilligung, istFassungBekannt: boolean | null = true): string =>
  renderMarkup(FormEinwilligungSection, { einwilligung, istFassungBekannt });
const words = (einwilligung: FLEinwilligung, istFassungBekannt: boolean | null = true): string =>
  textOf(markup(einwilligung, istFassungBekannt));

/** The panel's last paragraph, which is where the publication rule is written. */
const closingNote = (einwilligung: FLEinwilligung): string => {
  const paragraphs = [...markup(einwilligung).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((found) => textOf(found[1] ?? ""));

  return paragraphs.at(-1) ?? "";
};

describe("the stored consent panel", () => {
  it("renders every scope the record can carry", () => {
    const umfaenge = Object.keys(EINWILLIGUNG_UMFANG_LABELS) as FLEinwilligung["umfang"][];
    // Floored, because a loop over a table that has emptied runs zero times and reports clean.
    assert.ok(umfaenge.length >= 2, "the scope table is short of the two the record declares");

    for (const umfang of umfaenge) {
      assert.ok(words({ ...OHNE_MEDIEN, umfang }).includes(EINWILLIGUNG_UMFANG_LABELS[umfang]), `${umfang} renders no label`);
    }
  });

  it("offers nothing to type into, the field being immutable", () => {
    assert.doesNotMatch(markup(OHNE_MEDIEN), /<(input|select|textarea)\b/, "a read-only record renders a control");
  });

  it("says that the record cannot be edited, standing among panels that can", () => {
    assert.ok(words(OHNE_MEDIEN).includes("lassen sich nicht bearbeiten"), "nothing tells the reader these facts are read-only");
  });

  it("keeps the heading level the shell's other sections take", () => {
    const html = markup(OHNE_MEDIEN);
    assert.match(html, /<h2\b/, "the panel renders no heading");
    assert.doesNotMatch(html, /<h1\b/, "the section gives the shell page a second h1");
  });

  it("shows the wording a record cites", () => {
    // Floored on the registry, because the fixture's own label is what the assertion under it
    // greps for: a key the registry stopped answering would take the resolving branch with it.
    assert.ok(Object.hasOwn(readEinwilligungDocument().fassungen, FASSUNG), "the fixture cites a label the registry does not hold");
    assert.ok(words(ERTEILT).includes(FASSUNG), "the stored wording label is not shown");
  });

  it("marks a label the wording registry answers with nothing, beside the key itself", () => {
    assert.ok(!Object.hasOwn(readEinwilligungDocument().fassungen, UNBEKANNTE_FASSUNG), "the fixture names a label the registry does answer");

    const text = words({ ...ERTEILT, text_version: UNBEKANNTE_FASSUNG }, false);

    assert.ok(text.includes(UNBEKANNTE_FASSUNG), "the key that resolved to nothing is not shown");
    assert.ok(text.includes("Unbekannte Fassung"), "a record citing words nobody can produce reads as an ordinary one");
  });

  /* The registry's read failed: the key stands, and the panel says the check was not made rather than
     calling a label known or unknown. */
  it("says the label went unchecked where the registry could not be read", () => {
    const text = words(ERTEILT, null);

    assert.ok(text.includes(FASSUNG) && text.includes("Nicht geprüft"), "an unchecked label reads as a checked one");
    assert.ok(!text.includes("Unbekannte Fassung"), "an unchecked label reads as an unknown one");
  });

  it("reads the media consent as a word on either answer", () => {
    // Floored, because `includes("")` holds of any render: a label edited to empty passes both
    // assertions below, and one copied over the other passes them against a panel showing either.
    assert.ok(EINWILLIGUNG_MEDIEN_LABELS.erteilt.length > 0, "the granted label has emptied");
    assert.notEqual(EINWILLIGUNG_MEDIEN_LABELS.erteilt, EINWILLIGUNG_MEDIEN_LABELS.nicht_erteilt, "the two answers read alike");
    assert.ok(words(ERTEILT).includes(EINWILLIGUNG_MEDIEN_LABELS.erteilt), "a media consent renders no word");
    assert.ok(words(OHNE_MEDIEN).includes(EINWILLIGUNG_MEDIEN_LABELS.nicht_erteilt), "a record carrying none renders no word");
  });

  /* The account page moves one choice and leaves the confirmation's day and label standing, so a
     choice read beside those alone would claim the person decided it on the confirmation day. */
  it("reads each choice with the act it stands on, a withdrawal naming the grant it ended", () => {
    const zurueckgenommen: FLEinwilligung = {
      ...ERTEILT,
      medien: false,
      nachweis: {
        umfang: BESTAETIGUNG,
        medien: {
          am: "2026-10-04T08:00:00Z",
          text_version: "2026-10-konto-spieler",
          erteilt_zuvor: { am: "2026-03-04T09:00:00Z", text_version: FASSUNG },
        },
      },
    };
    const text = words(zurueckgenommen);

    assert.ok(text.includes("seit 04.10.2026, 10:00 Uhr, Fassung 2026-10-konto-spieler"), "the media choice reads without its own act");
    assert.ok(text.includes("zuvor erteilt am 04.03.2026, 10:00 Uhr"), "the withdrawal hides the grant it ended");
    assert.ok(text.includes(`seit 04.03.2026, 10:00 Uhr, Fassung ${FASSUNG}`), "a choice never moved does not stand on its confirmation's act");
  });

  it("shows the day the record was given and the day it was confirmed", () => {
    const text = words({ ...ERTEILT, datum: "2026-03-02" });

    assert.match(text, /Erteilt am\s*02\.03\.2026/, "the day the consent was given is not shown");
    assert.match(text, /Bestätigt am\s*04\.03\.2026/, "the day the consent was confirmed is not shown");
  });

  /* A stamp a hand edit blanked reads as none (`docs/backend/spec.md :: I387`): a state of the record, never a value the
     panel holds no copy of, which „Nicht hinterlegt“ would claim. */
  it("reads a record whose confirmation stamp is blanked as not confirmed", () => {
    const html = markup({ ...ERTEILT, bestaetigt_am: null });

    assertLeerMarkup(html, "Nicht bestätigt");
    assert.match(textOf(html), /Bestätigt am\s*Nicht bestätigt/, "the stamp's row reads otherwise");
  });

  /* Compared whole rather than by an opening fragment: „steuert die Veröffentlichung“ is a prefix of
     its own negation, so a sentence saying the opposite about a pupil's privacy passes on it. */
  it("names the publication rule whichever scope the record holds", () => {
    const withheld: FLEinwilligung = { ...OHNE_MEDIEN, umfang: "intern" };

    for (const record of [OHNE_MEDIEN, withheld]) {
      assert.equal(closingNote(record), EINWILLIGUNG_VEROEFFENTLICHUNG_HINWEIS, "the panel closes on words the constant does not carry");
    }
  });
});
