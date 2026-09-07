import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { KONTAKT_ROLLEN } from "@/features/teams/constants";
import { renderMarkup, textOf } from "@/shared/testing/renderTest";

import type { FLKontaktSitz } from "../../../schemas.ts";

/* Reached after the harness above has evaluated, which is when the JSX compile step is registered: a
   static import beside it resolves first and dies on the extension. */
const { FormKontaktReveal } = await import("./FormKontaktReveal.tsx");

const TRAINERIN: FLKontaktSitz = { saison_id: "2526", rolle: "trainer", vorname: "Wiltrudis", nachname: "Quastenflosser" };
const ANSPRECHPERSON: FLKontaktSitz = { saison_id: "2425", rolle: "ansprechperson", vorname: "Ortwinia", nachname: "Pfeffernuss" };

const markup = (saison_teams: FLKontaktSitz[], bewerbungen: FLKontaktSitz[]): string =>
  renderMarkup(FormKontaktReveal, { saison_teams, bewerbungen });
const words = (saison_teams: FLKontaktSitz[], bewerbungen: FLKontaktSitz[]): string => textOf(markup(saison_teams, bewerbungen));

/** Whom each listed seat is held for, in document order. */
const genannte = (html: string): string[] => [...html.matchAll(/<dd\b[^>]*>(.*?)<\/dd>/g)].map((treffer) => textOf(treffer[1] ?? ""));

describe("the reveal an erasure is confirmed over", () => {
  it("names every seat the address holds, across both collections", () => {
    assert.deepEqual(
      genannte(markup([TRAINERIN], [ANSPRECHPERSON])),
      ["Wiltrudis Quastenflosser", "Ortwinia Pfeffernuss"],
      "the confirmation names fewer people than the write would clear",
    );
  });

  it("renders each seat as a fact about the place it sits in", () => {
    // A person's name is the `<dd>` under the place's `<dt>`, which is the emphasis every other
    // admin readout gives one — in prose it would read as the sentence's least important half.
    assert.match(
      markup([TRAINERIN], []),
      /<dt[^>]*>Saison 2526 · [^<]*<\/dt><dd[^>]*>Wiltrudis Quastenflosser<\/dd>/,
      "a seat is two strings sharing a line",
    );
  });

  it("places an application seat in its Bewerbung and never in a Saison", () => {
    const text = words([], [TRAINERIN]);

    assert.match(text, /Bewerbung 2526/, "an application seat is not placed in the application it sits on");
    assert.doesNotMatch(text, /Saison 2526/, "an application reads as a season already played");
  });

  it("spells every seat with the label table's own word", () => {
    // Floored, because a loop over a table that has emptied runs zero times and reports clean.
    assert.ok(KONTAKT_ROLLEN.length >= 3, "the seat table is short of the three a block holds");

    for (const { value, label } of KONTAKT_ROLLEN) {
      assert.ok(words([{ ...TRAINERIN, rolle: value }], []).includes(`Saison 2526 · ${label}`), `${value} is placed without its own label`);
    }
  });

  it("keeps one person's two seats in one season apart", () => {
    // `trainer_ist_zugleich` seats one person twice in one row, and without the role beside the name
    // the pair renders as one line written out twice.
    const paar = markup([TRAINERIN, { ...TRAINERIN, rolle: "ansprechperson" }], []);

    assert.equal(genannte(paar).length, 2, "one person's two seats collapse into one row");
    assert.notEqual(
      /<dt[^>]*>([^<]*)<\/dt>/.exec(paar)?.[1],
      [...paar.matchAll(/<dt[^>]*>([^<]*)<\/dt>/g)][1]?.[1],
      "two seats of one season are labelled alike",
    );
  });

  it("says the address matched nobody rather than showing an empty list", () => {
    assert.match(words([], []), /in keiner Saison und in keiner Bewerbung/, "an address matching nobody renders a list with no rows");
  });

  it("still states what the write clears where nothing matched", () => {
    // A person edited out of a row leaves an image the erasure redacts whether or not a seat matched,
    // so „nichts gefunden“ standing alone would read as „nichts passiert“.
    assert.match(words([], []), /Änderungsprotokoll/, "an unmatched address reads as an erasure that does nothing");
  });
});
