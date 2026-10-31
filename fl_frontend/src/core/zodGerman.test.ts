import { describe, expect, it } from "vitest";
import { z } from "zod";

import { COPY } from "./copy.ts";
import { fieldMessage } from "./zodGerman.ts";

import type { Beispiele } from "./zodGerman.ts";

const { feld, fehler } = COPY.shared;

/** The message the first issue of a parse carries, worded by the map as a builder hands it the field examples. */
function message(schema: z.ZodType, value: unknown, beispiele?: Beispiele): string | undefined {
  const parsed = schema.safeParse(value, { error: (issue) => fieldMessage(issue, beispiele) });
  return parsed.error?.issues[0]?.message;
}

describe("the one German field map", () => {
  it("asks for a value wherever a box is left empty, whichever check meets it", () => {
    const form = z.object({ name: z.string().min(2), saison: z.enum(["2025", "2026"]), plz: z.string().regex(/^\d{5}$/) });

    for (const empty of [{ name: "" }, { saison: undefined }, { plz: null }]) {
      const parsed = form.safeParse({ name: "Al", saison: "2026", plz: "60311", ...empty }, { error: (issue) => fieldMessage(issue) });
      expect(
        parsed.error?.issues.map(({ message }) => message),
        JSON.stringify(empty),
      ).toStrictEqual([feld.pflichtfeld]);
    }
  });

  it("states a text's ceiling and floor in characters", () => {
    expect(message(z.string().max(80), "x".repeat(81))).toBe(feld.hoechstensZeichen(80));
    expect(message(z.string().min(3), "ab")).toBe(feld.mindestensZeichen(3));
  });

  it("states a number's two bounds together, whichever it passed", () => {
    expect(message(z.number().min(1).max(11), 12)).toBe(feld.zwischen(1, 11));
    expect(message(z.number().min(1).max(11), 0)).toBe(feld.zwischen(1, 11));
  });

  it("shows a malformed value the field's own example, and an address the address example", () => {
    const form = z.object({ adresse: z.object({ plz: z.string().regex(/^\d{5}$/) }) });

    expect(message(form, { adresse: { plz: "6031" } }, { "adresse.plz": feld.beispielZiffern })).toBe(feld.format(feld.beispielZiffern));
    expect(message(z.email(), "kein-at")).toBe(feld.format(feld.beispielAdresse));
  });

  it("answers what no pattern words with the one unexpected line, never Zod's English", () => {
    expect(message(z.object({ a: z.string() }).strict(), { a: "x", b: 1 })).toBe(fehler.unerwartet);
    expect(message(z.string().regex(/^\d+$/), "abc")).toBe(fehler.unerwartet);
  });
});
