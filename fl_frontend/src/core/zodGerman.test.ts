import { describe, expect, it } from "vitest";
import { z } from "zod";

import { COPY } from "./copy.ts";
import { fieldMessage } from "./zodGerman.ts";

import type { Examples } from "./zodGerman.ts";

const { field, failure } = COPY.shared;

/** The message the first issue of a parse carries, worded by the map as a builder hands it the field examples. */
function message(schema: z.ZodType, value: unknown, examples?: Examples): string | undefined {
  const parsed = schema.safeParse(value, { error: (issue) => fieldMessage(issue, examples) });
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
      ).toStrictEqual([field.required]);
    }
  });

  it("states a text's ceiling and floor in characters", () => {
    expect(message(z.string().max(80), "x".repeat(81))).toBe(field.maxChars(80));
    expect(message(z.string().min(3), "ab")).toBe(field.minChars(3));
  });

  it("states a number's two bounds together, whichever it passed", () => {
    expect(message(z.number().min(1).max(11), 12)).toBe(field.between(1, 11));
    expect(message(z.number().min(1).max(11), 0)).toBe(field.between(1, 11));
  });

  it("states a number's one bound alone, the integer's own range being no rule's", () => {
    expect(message(z.int().min(0), -1)).toBe(field.min(0));
    expect(message(z.int().max(5), 6)).toBe(field.max(5));
  });

  it("names an integer's exclusive bound as the first figure the rule takes", () => {
    expect(message(z.int().gt(0).max(16), 0)).toBe(field.between(1, 16));
    expect(message(z.int().gt(0).max(16), 17)).toBe(field.between(1, 16));
    expect(message(z.int().gt(0), 0)).toBe(field.min(1));
    expect(message(z.int().lt(10), 10)).toBe(field.max(9));
  });

  it("asks for a pick where a list is empty, and states a list's bounds in its own count", () => {
    expect(message(z.array(z.string()).min(1), [])).toBe(field.required);
    expect(message(z.array(z.string()).min(2), ["E1"])).toBe(field.min(2));
    expect(message(z.array(z.string()).max(2), ["E1", "E2", "Q1"])).toBe(field.max(2));
  });

  it("shows a malformed value the field's own example, and an address the address example", () => {
    const form = z.object({ adresse: z.object({ plz: z.string().regex(/^\d{5}$/) }) });

    expect(message(form, { adresse: { plz: "6031" } }, { "adresse.plz": field.exampleDigits })).toBe(field.format(field.exampleDigits));
    expect(message(z.email(), "no-at")).toBe(field.format(field.exampleAddress));
  });

  it("answers what no pattern words with the one unexpected line, never Zod's English", () => {
    expect(message(z.object({ a: z.string() }).strict(), { a: "x", b: 1 })).toBe(failure.unexpected);
    expect(message(z.string().regex(/^\d+$/), "abc")).toBe(failure.unexpected);
  });
});
