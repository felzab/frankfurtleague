import { describe, expect, it } from "vitest";
import { z } from "zod";

import { COPY } from "./copy.ts";
import { SERVER_COPY } from "./serverCopy.ts";
import { fieldMessage, ruleMessage } from "./zodGerman.ts";

import type { FLRefusedField } from "./generated/client/types.ts";
import type { Beispiele } from "./zodGerman.ts";

const { field, failure } = COPY.shared;

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

  it("names an integer's exclusive bound as the first figure the rule takes, and words a decimal's not at all", () => {
    expect(message(z.int().gt(0).max(16), 0)).toBe(field.between(1, 16));
    expect(message(z.int().gt(0).max(16), 17)).toBe(field.between(1, 16));
    expect(message(z.int().gt(0), 0)).toBe(field.min(1));
    expect(message(z.int().lt(10), 10)).toBe(field.max(9));
    expect(message(z.number().gt(0), 0)).toBe(failure.unexpected);
  });

  it("asks for a pick where a list is empty, and states a list's bounds in its own count", () => {
    expect(message(z.array(z.string()).min(1), [])).toBe(field.required);
    expect(message(z.array(z.string()).min(2), ["E1"])).toBe(field.min(2));
    expect(message(z.array(z.string()).max(2), ["E1", "E2", "Q1"])).toBe(field.max(2));
  });

  it("shows a malformed value the field's own example, and an address the address example", () => {
    const form = z.object({ adresse: z.object({ plz: z.string().regex(/^\d{5}$/) }) });

    expect(message(form, { adresse: { plz: "6031" } }, { "adresse.plz": field.exampleDigits })).toBe(field.format(field.exampleDigits));
    expect(message(z.email(), "kein-at")).toBe(field.format(field.exampleAddress));
  });

  it("answers what no pattern words with the one unexpected line, never Zod's English", () => {
    expect(message(z.object({ a: z.string() }).strict(), { a: "x", b: 1 })).toBe(failure.unexpected);
    expect(message(z.string().regex(/^\d+$/), "abc")).toBe(failure.unexpected);
  });
});

describe("the same map over the backend's rules", () => {
  const rule = (kind: string, ctx: FLRefusedField["ctx"] = {}) => ruleMessage({ kind, ctx });

  it("words each rule a pattern holds from the bound its context names, as the box's own check would", () => {
    const start = "2026-09-01";
    expect(rule("saison_ends_before_start", { start })).toBe(field.earliest(start));
    expect(rule("bewerbung_window_ends_before_start", { start })).toBe(field.earliest(start));
    expect(rule("registrierung_window_ends_before_start", { start })).toBe(field.earliest(start));
    expect(rule("spieltag_ends_before_start", { start })).toBe(field.earliest(start));
    expect(rule("good_spieler_exceed_kader", { max: 8 })).toBe(field.max(8));
    for (const kind of ["ergebnis_missing_tore", "decline_without_proposal", "decline_without_reason"]) {
      expect(rule(kind), kind).toBe(field.required);
    }
    expect(rule("email_not_accepted")).toBe(field.format(field.exampleAddress));
    expect(rule("date_not_in_calendar")).toBe(field.format(field.exampleDate));
    expect(rule("url_not_accepted")).toBe(field.format(field.exampleUrl));
    expect(rule("address_in_free_text")).toBe(field.without(COPY.signIn.address));
    // A repeat across the list of contact persons, which no box names: the line names the repeated value.
    expect(rule("kontakt_email_twice")).toBe(COPY.template.namedField(COPY.signIn.address, field.taken));
    expect(rule("kontakt_telefon_twice")).toBe(COPY.template.namedField(COPY.shared.phoneNumber, field.taken));
  });

  it("prints a season's year bounds with no thousands separator", () => {
    expect(rule("saison_year_out_of_range", { min: 2026, max: 2027 })).toBe("Zwischen 2026 und 2027");
  });

  it("words a rule no pattern holds in its own phrase, and anything else, a missing bound among it, as unexpected", () => {
    expect(rule("elfmeterschiessen_without_draw")).toBe(SERVER_COPY.rule.elfmeterschiessen_without_draw);
    expect(rule("good_spieler_exceed_kader")).toBe(failure.unexpected);
    expect(rule("string_too_long", { max_length: 80 })).toBe(failure.unexpected);
  });
});
