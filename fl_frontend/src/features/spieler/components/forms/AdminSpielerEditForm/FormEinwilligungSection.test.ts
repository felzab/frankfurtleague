import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderMarkup, textOf } from "@/shared/testing/renderTest";
import { PLACEHOLDER } from "@/shared/utils/format";

import { EINWILLIGUNG_HERKUNFT_LABELS, EINWILLIGUNG_UMFANG_LABELS } from "../../../constants.ts";

import type { FLEinwilligung } from "../../../schemas.ts";

/* Reached after the harness above has evaluated, which is when the JSX compile step is registered: a
   static import beside it resolves first and dies on the extension. */
const { FormEinwilligungSection } = await import("./FormEinwilligungSection.tsx");

/** A record carried over with the data rather than asked for, which is what every stored pupil holds. */
const UEBERNOMMEN: FLEinwilligung = { umfang: "kader_oeffentlich", erteilt_von: "bestandsuebernahme", datum: null, bestaetigt_am: null };

/** What `fl_backend/app/api/spieler/services.py :: registration_einwilligung` composes for a registration. */
const ERTEILT: FLEinwilligung = {
  umfang: "kader_oeffentlich",
  erteilt_von: "erziehungsberechtigt",
  datum: "2026-03-04",
  bestaetigt_am: "2026-03-04",
};

const markup = (einwilligung: FLEinwilligung | null): string => renderMarkup(FormEinwilligungSection, { einwilligung });
const words = (einwilligung: FLEinwilligung | null): string => textOf(markup(einwilligung));

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
    for (const [name, record] of [
      ["a stored record", UEBERNOMMEN],
      ["an empty panel", null],
    ] as const) {
      const text = words(record);
      // `Spielers` counts as masculine and `Spielerin` does not, which is what makes the two runs
      // comparable rather than one counting the other.
      const maskulin = (text.match(/Spieler(?!in)/g) ?? []).length;

      assert.ok(maskulin > 0, `${name}: no player noun at all, so this case judges nothing`);
      assert.equal((text.match(/Spielerin/g) ?? []).length, maskulin, `${name}: a masculine player noun stands without its pair`);
    }
  });

  /* The readout has no sentence beside it to qualify a gendered noun, so each origin is named
     without one — and `bestandsuebernahme` stays the plain word a softened one would blur. */
  it("names whoever gave a consent without a gendered noun", () => {
    for (const [herkunft, label] of Object.entries(EINWILLIGUNG_HERKUNFT_LABELS)) {
      assert.doesNotMatch(label, /Spieler/, `${herkunft} names the squad member's gender in a readout`);
    }
  });

  it("refuses the publication reading on both branches, the record gating nothing", () => {
    const withheld: FLEinwilligung = { ...UEBERNOMMEN, umfang: "intern" };

    // `intern` is the case that misreads: rendered as „Nur innerhalb der Liga“ beside no such
    // sentence, it reads as this player's name being off the public squad list, which it is not.
    for (const record of [UEBERNOMMEN, withheld, null]) {
      assert.ok(words(record).includes("steuert die Veröffentlichung nicht"), "the panel reads as a promise about the public squad list");
    }
  });
});
