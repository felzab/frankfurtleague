import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderMarkup, textOf } from "@/shared/testing/renderTest";

const { DatenschutzView } = await import("./DatenschutzView.tsx");

const MARKUP = renderMarkup(DatenschutzView, {});

const worte = (html: string): string => textOf(html, " ").replace(/\s+/g, " ").trim();

/** The label-and-value pairs of both `<dl>` lists, the retention table among them, keyed by the label. */
const ANGABEN = new Map(
  [...MARKUP.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/g)].map((pair) => [
    worte(pair[1] ?? ""),
    worte(pair[2] ?? ""),
  ]),
);

describe("the privacy notice's retention table", () => {
  /* Nothing deletes an invite row, so the cell promises the link's end and never the entry's: a
     retention promise no sweep performs is one a reader can hold us to. */
  it("says a team's registration link expires while its entry stays", () => {
    assert.equal(
      ANGABEN.get(
        "Registrierungslink eines Teams: der Link als unlesbarer Schlüssel, dazu das Datum und die anlegende Person aus der Verwaltung",
      ),
      "Kein eigener Zeitraum: Der Link endet mit der Registrierungsfrist der Saison, für die er gilt, oder sobald die Verwaltung ihn " +
        "zurückzieht oder durch einen neuen ersetzt. Der Eintrag dazu nennt keine Person und enthält den Link nur als unlesbaren " +
        "Schlüssel; er bleibt bestehen.",
    );
  });
});
