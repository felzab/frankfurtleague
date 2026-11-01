import { describe, expect, it } from "vitest";

import { COPY } from "./copy.ts";

import type { Copy } from "./copy.ts";

const zeige = (text: Copy): Copy => text;

describe("Copy", () => {
  it("takes a catalogue entry and refuses a string typed in place", () => {
    zeige(COPY.shared.saved);
    zeige(COPY.shared.field.maxChars(80));
    // @ts-expect-error -- the refusal under test: a raw string is no `Copy`.
    zeige("Gespeichert");
  });
});

describe("a verb with its object", () => {
  // The label is capitalised and the infinitive after an object is not, an umlaut included.
  it("lower-cases the verb behind its object", () => {
    expect(COPY.shared.withObject(COPY.shared.protokoll, "adopt")).toBe("Protokoll übernehmen");
    expect(COPY.shared.question(COPY.shared.protokoll, "delete")).toBe("Protokoll löschen?");
  });
});

describe("a season's name", () => {
  it("names the season by its year, which takes no thousands separator", () => {
    expect(COPY.shared.saisonName("2027")).toBe("Saison 2027");
  });
});

describe("a field message", () => {
  it("writes its figure in the German form", () => {
    expect(COPY.shared.field.maxChars(1000)).toBe("Höchstens 1.000 Zeichen");
    expect(COPY.shared.field.earliest("2027-03-14")).toBe("Frühestens 14.03.2027");
  });
});
