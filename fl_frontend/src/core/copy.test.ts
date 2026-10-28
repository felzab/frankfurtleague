import { describe, expect, it } from "vitest";

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
    expect(COPY.shared.mitObjekt(COPY.shared.protokoll, "uebernehmen")).toBe("Protokoll übernehmen");
    expect(COPY.shared.frage(COPY.shared.protokoll, "loeschen")).toBe("Protokoll löschen?");
  });
});

describe("the failure no reason names", () => {
  it("reads one line, the same in a toast and in a status line", () => {
    expect(COPY.shared.fehler.unerwartet).toBe("Etwas ist schiefgelaufen");
    expect(COPY.shared.toast.fehler).toBe(COPY.shared.fehler.unerwartet);
  });
});

describe("a field message", () => {
  it("writes its figure in the German form", () => {
    expect(COPY.shared.feld.hoechstensZeichen(1000)).toBe("Höchstens 1.000 Zeichen");
    expect(COPY.shared.feld.fruehestens("2027-03-14")).toBe("Frühestens 14.03.2027");
  });
});
