import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { einwilligungFassung } from "@/core/einwilligung";
import { renderMarkup, textOf } from "@/shared/testing/renderTest";
import { PLACEHOLDER } from "@/shared/utils/format";

import {
  EINWILLIGUNG_HERKUNFT_LABELS,
  EINWILLIGUNG_MEDIEN_LABELS,
  EINWILLIGUNG_UMFANG_LABELS,
  EINWILLIGUNG_VEROEFFENTLICHUNG_HINWEIS,
} from "../../../constants.ts";

import type { FLEinwilligung } from "../../../schemas.ts";

/* Reached after the harness above has evaluated, which is when the JSX compile step is registered: a
   static import beside it resolves first and dies on the extension. */
const { FormEinwilligungSection } = await import("./FormEinwilligungSection.tsx");

/** A label `@/core/einwilligung :: LIGA_KENNTNISNAHMEN` answers, which is the branch a stored record is meant to take. */
const FASSUNG = "2026-09-bestaetigung-3";

/** A label it answers with nothing — what a record stamped under a wording since removed would carry. */
const UNBEKANNTE_FASSUNG = "liga-2019-01-erfunden";

/** A record carried over with the data rather than asked for, which is what every stored pupil holds. */
const UEBERNOMMEN: FLEinwilligung = {
  umfang: "kader_oeffentlich",
  erteilt_von: "bestandsuebernahme",
  datum: null,
  bestaetigt_am: null,
  text_version: null,
  medien: false,
};

/** A consent the registration flow collected: dated, confirmed, and citing the wording its person was shown. */
const ERTEILT: FLEinwilligung = {
  umfang: "kader_oeffentlich",
  erteilt_von: "erziehungsberechtigt",
  datum: "2026-03-04",
  bestaetigt_am: "2026-03-04",
  text_version: FASSUNG,
  medien: true,
};

const markup = (einwilligung: FLEinwilligung | null): string => renderMarkup(FormEinwilligungSection, { einwilligung });
const words = (einwilligung: FLEinwilligung | null): string => textOf(markup(einwilligung));

/** The panel's last paragraph, which is where the publication rule is written on either branch. */
const closingNote = (einwilligung: FLEinwilligung | null): string => {
  const paragraphs = [...markup(einwilligung).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((found) => textOf(found[1] ?? ""));

  return paragraphs.at(-1) ?? "";
};

describe("the stored consent panel", () => {
  it("names the carry-over where the record is one, and never where somebody consented", () => {
    assert.ok(words(UEBERNOMMEN).includes(EINWILLIGUNG_HERKUNFT_LABELS.bestandsuebernahme), "a backfilled record does not read as one");
    assert.ok(!words(ERTEILT).includes(EINWILLIGUNG_HERKUNFT_LABELS.bestandsuebernahme), "a consent somebody gave reads as a carry-over");
    assert.ok(words(ERTEILT).includes(EINWILLIGUNG_HERKUNFT_LABELS.erziehungsberechtigt), "a consent somebody gave does not say who");
  });

  it("renders every origin and every scope the record can carry", () => {
    const herkuenfte = Object.keys(EINWILLIGUNG_HERKUNFT_LABELS) as FLEinwilligung["erteilt_von"][];
    const umfaenge = Object.keys(EINWILLIGUNG_UMFANG_LABELS) as FLEinwilligung["umfang"][];
    // Floored, because a loop over a table that has emptied runs zero times and reports clean.
    assert.ok(herkuenfte.length >= 3, "the origin table is short of the three the record declares");
    assert.ok(umfaenge.length >= 2, "the scope table is short of the two the record declares");

    for (const erteilt_von of herkuenfte) {
      assert.ok(words({ ...UEBERNOMMEN, erteilt_von }).includes(EINWILLIGUNG_HERKUNFT_LABELS[erteilt_von]), `${erteilt_von} renders no label`);
    }
    for (const umfang of umfaenge) {
      assert.ok(words({ ...UEBERNOMMEN, umfang }).includes(EINWILLIGUNG_UMFANG_LABELS[umfang]), `${umfang} renders no label`);
    }
  });

  it("offers nothing to type into, the field being immutable", () => {
    assert.doesNotMatch(markup(UEBERNOMMEN), /<(input|select|textarea)\b/, "a read-only record renders a control");
  });

  it("says that the record cannot be edited, standing among panels that can", () => {
    assert.ok(words(UEBERNOMMEN).includes("lassen sich nicht bearbeiten"), "nothing tells the reader these facts are read-only");
  });

  it("keeps the heading level the shell's other sections take", () => {
    const html = markup(UEBERNOMMEN);
    assert.match(html, /<h2\b/, "the panel renders no heading");
    assert.doesNotMatch(html, /<h1\b/, "the section gives the shell page a second h1");
  });

  it("leaves an unasked consent undated without borrowing the fixture placeholder", () => {
    const text = words(UEBERNOMMEN);
    assert.ok(!text.includes(PLACEHOLDER.datum), "an absent day promises a day that is coming");
    assert.ok(text.includes("Kein Datum"), "an absent day renders as blank rather than as an absence");
  });

  it("shows the wording a record cites, and says in words where it cites none", () => {
    // Floored on the registry, because the fixture's own label is what the assertion under it
    // greps for: a key the registry stopped answering would take the resolving branch with it.
    assert.notEqual(einwilligungFassung(FASSUNG), null, "the fixture cites a label the registry no longer answers");
    assert.ok(words(ERTEILT).includes(FASSUNG), "the stored wording label is not shown");
    // The label is the registry key rather than a sentence, so an absent one renders as blank
    // unless the panel words it — and a blank cell reads as a record nobody has finished filling.
    assert.ok(words(UEBERNOMMEN).includes("Nicht erfasst"), "a record citing no wording renders an empty cell");
  });

  it("marks a label the wording registry answers with nothing, beside the key itself", () => {
    assert.equal(einwilligungFassung(UNBEKANNTE_FASSUNG), null, "the fixture names a label the registry does answer");

    const text = words({ ...ERTEILT, text_version: UNBEKANNTE_FASSUNG });

    assert.ok(text.includes(UNBEKANNTE_FASSUNG), "the key that resolved to nothing is not shown");
    assert.ok(text.includes("Unbekannte Fassung"), "a record citing words nobody can produce reads as an ordinary one");
  });

  it("reads the media consent as a word on either answer", () => {
    // Floored, because `includes("")` holds of any render: a label edited to empty passes both
    // assertions below, and one copied over the other passes them against a panel showing either.
    assert.ok(EINWILLIGUNG_MEDIEN_LABELS.erteilt.length > 0, "the granted label has emptied");
    assert.notEqual(EINWILLIGUNG_MEDIEN_LABELS.erteilt, EINWILLIGUNG_MEDIEN_LABELS.nicht_erteilt, "the two answers read alike");
    assert.ok(words(ERTEILT).includes(EINWILLIGUNG_MEDIEN_LABELS.erteilt), "a media consent renders no word");
    assert.ok(words(UEBERNOMMEN).includes(EINWILLIGUNG_MEDIEN_LABELS.nicht_erteilt), "a record carrying none renders no word");
  });

  it("reads an unconfirmed record as a state rather than a missing day", () => {
    assert.ok(words(UEBERNOMMEN).includes("Nicht bestätigt"), "an unconfirmed consent reads as a gap");
    assert.ok(words(ERTEILT).includes("04.03.2026"), "a confirmed consent does not show the day it was confirmed");
  });

  it("says so where the person carries no record at all, and that none is entered here", () => {
    const text = words(null);
    assert.ok(text.includes("keine Einwilligung"), "a person with no consent gets a panel saying nothing");
    // The read-only sentence renders on the other branch alone, so this one carries the missing
    // control itself: an empty panel among four editable ones is read as one still to be filled.
    assert.ok(text.includes("Eintragen lässt sie sich nicht"), "an empty panel sends the reader looking for a control");
    // The absence is the whole product's, so a scope word here would send the reader to hunt for the
    // panel that does hold the control.
    assert.ok(!text.includes("sich hier nicht"), "the sentence scopes the absence to this panel");
  });

  /* Half the league's squads are girls, and one panel calling the same person „dieser Spieler“ in one
     sentence and „jeder Spielerin und jedes Spielers“ in the next is wrong about half of them. */
  it("pairs the feminine form wherever it names a player at all", () => {
    let maskulinInsgesamt = 0;

    for (const [name, record] of [
      ["a stored record", UEBERNOMMEN],
      ["an empty panel", null],
    ] as const) {
      const text = words(record);
      // `Spielers` counts as masculine and `Spielerin` does not, which is what makes the two runs
      // comparable rather than one counting the other.
      const maskulin = (text.match(/Spieler(?!in)/g) ?? []).length;

      maskulinInsgesamt += maskulin;
      assert.equal((text.match(/Spielerin/g) ?? []).length, maskulin, `${name}: a masculine player noun stands without its pair`);
    }

    // Floored over the panel rather than per render: the stored branch names „die Person“ throughout,
    // and a run finding no noun in either render would report a panel of pronouns as paired.
    assert.ok(maskulinInsgesamt > 0, "neither render names a player, so this case judges nothing");
  });

  /* The readout has no sentence beside it to qualify a gendered noun, so each origin is named
     without one — and `bestandsuebernahme` stays the plain word a softened one would blur. */
  it("names whoever gave a consent without a gendered noun", () => {
    for (const [herkunft, label] of Object.entries(EINWILLIGUNG_HERKUNFT_LABELS)) {
      assert.doesNotMatch(label, /Spieler/, `${herkunft} names the squad member's gender in a readout`);
    }
  });

  /* Compared whole rather than by an opening fragment: „steuert die Veröffentlichung“ is a prefix of
     its own negation, so a sentence saying the opposite about a pupil's privacy passes on it. */
  it("names the publication rule on both branches, the record steering it", () => {
    const withheld: FLEinwilligung = { ...UEBERNOMMEN, umfang: "intern" };

    // The empty branch needs it as much as the stored one: an administrator meeting a panel with no
    // record would otherwise read the public squad list as the whole story about this person.
    for (const record of [UEBERNOMMEN, withheld, null]) {
      assert.equal(closingNote(record), EINWILLIGUNG_VEROEFFENTLICHUNG_HINWEIS, "the panel closes on words the constant does not carry");
    }
  });
});
