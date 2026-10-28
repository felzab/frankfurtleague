import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COPY } from "./copy.ts";

import type { Copy } from "./copy.ts";

const zeige = (text: Copy): Copy => text;

describe("Copy", () => {
  it("takes a catalogue entry and refuses a string typed in place", () => {
    zeige(COPY.shared.gespeichert);
    zeige(COPY.shared.feld.hoechstensZeichen(80));
    // @ts-expect-error -- the refusal under test: a raw string is no `Copy`.
    zeige("Gespeichert");
  });
});

describe("a verb with its object", () => {
  // The label is capitalised and the infinitive after an object is not, an umlaut included.
  it("lower-cases the verb behind its object", () => {
    assert.equal(COPY.shared.mitObjekt(COPY.shared.protokoll, "uebernehmen"), "Protokoll übernehmen");
    assert.equal(COPY.shared.frage(COPY.shared.protokoll, "loeschen"), "Protokoll löschen?");
  });
});

describe("a field message", () => {
  it("writes its figure in the German form", () => {
    assert.equal(COPY.shared.feld.hoechstensZeichen(1000), "Höchstens 1.000 Zeichen");
    assert.equal(COPY.shared.feld.fruehestens("2027-03-14"), "Frühestens 14.03.2027");
  });
});
