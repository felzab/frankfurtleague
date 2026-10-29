import { describe, expect, it } from "vitest";
import { z } from "zod";

import { COPY } from "./copy.ts";
import { feldMeldung } from "./zodGerman.ts";

import type { Beispiele } from "./zodGerman.ts";

const { feld, fehler } = COPY.shared;

/** The message the first issue of a parse carries, worded by the map as a builder hands it the field examples. */
function meldung(schema: z.ZodType, wert: unknown, beispiele?: Beispiele): string | undefined {
  const parsed = schema.safeParse(wert, { error: (issue) => feldMeldung(issue, beispiele) });
  return parsed.error?.issues[0]?.message;
}

describe("the one German field map", () => {
  it("asks for a value wherever a box is left empty, whichever check meets it", () => {
    const form = z.object({ name: z.string().min(2), saison: z.enum(["2025", "2026"]), plz: z.string().regex(/^\d{5}$/) });

    for (const leer of [{ name: "" }, { saison: undefined }, { plz: null }]) {
      const parsed = form.safeParse({ name: "Al", saison: "2026", plz: "60311", ...leer }, { error: (issue) => feldMeldung(issue) });
      expect(
        parsed.error?.issues.map(({ message }) => message),
        JSON.stringify(leer),
      ).toStrictEqual([feld.pflichtfeld]);
    }
  });

  it("states a text's ceiling and floor in characters", () => {
    expect(meldung(z.string().max(80), "x".repeat(81))).toBe(feld.hoechstensZeichen(80));
    expect(meldung(z.string().min(3), "ab")).toBe(feld.mindestensZeichen(3));
  });

  it("states a number's two bounds together, whichever it passed", () => {
    expect(meldung(z.number().min(1).max(11), 12)).toBe(feld.zwischen(1, 11));
    expect(meldung(z.number().min(1).max(11), 0)).toBe(feld.zwischen(1, 11));
  });

  it("shows a malformed value the field's own example, and an address the address example", () => {
    const form = z.object({ adresse: z.object({ plz: z.string().regex(/^\d{5}$/) }) });

    expect(meldung(form, { adresse: { plz: "6031" } }, { "adresse.plz": feld.beispielZiffern })).toBe(feld.format(feld.beispielZiffern));
    expect(meldung(z.email(), "kein-at")).toBe(feld.format(feld.beispielAdresse));
  });

  it("answers what no pattern words with the one unexpected line, never Zod's English", () => {
    expect(meldung(z.object({ a: z.string() }).strict(), { a: "x", b: 1 })).toBe(fehler.unerwartet);
    expect(meldung(z.string().regex(/^\d+$/), "abc")).toBe(fehler.unerwartet);
  });

  it("is the process's map, below a message a schema names itself", () => {
    expect(z.string().max(2).safeParse("abc").error?.issues[0]?.message).toBe(feld.hoechstensZeichen(2));
    expect(z.string().max(2, { error: "Höchstens 2 in der Reihe" }).safeParse("abc").error?.issues[0]?.message).toBe(
      "Höchstens 2 in der Reihe",
    );
  });
});
