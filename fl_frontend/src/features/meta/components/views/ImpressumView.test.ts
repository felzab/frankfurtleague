import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { VEREIN_ANSCHRIFT, VEREIN_NAME } from "@/core/brand.ts";
import { renderMarkup, textOf } from "@/shared/testing/renderTest";

const { ImpressumView } = await import("./ImpressumView.tsx");

/** A space for every tag, so the `<br />` between two board members never joins their names into one. */
const SEITE = textOf(renderMarkup(ImpressumView, {}), " ").replace(/\s+/g, " ").trim();

function abschnitt(title: string, next: string): string {
  const start = SEITE.indexOf(title);
  const end = SEITE.indexOf(next, start + title.length);

  // Throws rather than comparing a slice of the wrong section: a renamed heading leaves `indexOf`
  // at -1, and the comparison then runs from the top of the page and reports the wrong words.
  if (start === -1 || end === -1) throw new Error(`„${title}“ and „${next}“ do not both stand on the page, in that order`);

  return SEITE.slice(start + title.length, end).trim();
}

/** `NOTICE` as the bytes on disk, joined at its hard wrap: the name it spells falls across a line break. */
const NOTICE = readFileSync(path.resolve(import.meta.dirname, "..", "..", "..", "..", "..", "..", "NOTICE"))
  .toString("utf8")
  .replaceAll("\n", " ")
  .replace(/\s+/g, " ");

describe("the Impressum of the registered association", () => {
  /* Spelled out rather than read off the constant the page renders, which would compare the string
     to itself. „i. G.“ in its place names an association that does not legally exist yet. */
  it("names the association in its registered legal form", () => {
    assert.equal(abschnitt("Angaben gemäß § 5 DDG", "Vertreten durch den Vorstand"), `Frankfurt League e. V. ${VEREIN_ANSCHRIFT}`);
  });

  /* Four names and never one: any two of them bind the association together, so a section naming a
     single person would misstate who can. */
  it("names every board member with the office held, over the joint-representation sentence", () => {
    assert.equal(
      abschnitt("Vertreten durch den Vorstand", "Kontakt"),
      "David Daniel Wilbers, Vorsitzender Maria-Lucia Uribe Pacheco, Vorsitzende Matteo Müller, Stellvertreter Janosch Weiß, Schatzmeister " +
        "Jeweils zwei Vorstandsmitglieder vertreten den Verein gemeinsam.",
    );
  });

  /* The two chairs answer for the content and the other two do not, which is the whole of what
     `fl_frontend/src/core/brand.ts :: VORSTAND`'s `vorsitz` decides: a selector matching all four,
     or none, leaves a section that still reads plausibly. */
  it("holds the two Vorsitzende alone responsible for the content", () => {
    assert.equal(
      abschnitt("Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV", "Haftung für Inhalte"),
      `David Daniel Wilbers, ${VEREIN_ANSCHRIFT} Maria-Lucia Uribe Pacheco, ${VEREIN_ANSCHRIFT}`,
    );
  });

  it("gives the register court and the register number", () => {
    assert.equal(
      abschnitt("Registereintrag", "Umsatzsteuer-Identifikationsnummer"),
      "Eingetragen im Vereinsregister des Amtsgerichts Frankfurt am Main unter der Nummer VR 17757.",
    );
  });
});

describe("the legal name the notice file spells", () => {
  /* The notice says who owns the mark, so a second spelling there is a second claim about which
     body holds it — which is why every marker is read rather than the first. */
  it("spells it exactly as the page renders it", () => {
    const marker = /e\.\s*V\./g;
    const spellings = [...NOTICE.matchAll(marker)].map((found) =>
      NOTICE.slice(found.index + found[0].length - VEREIN_NAME.length, found.index + found[0].length),
    );

    assert.deepEqual([...new Set(spellings)], [VEREIN_NAME]);
  });
});
