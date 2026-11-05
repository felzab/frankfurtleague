import { describe, expect, it, onTestFinished, vi } from "vitest";

import { COPY } from "./copy.ts";
import { dayOf } from "./format.ts";
import { bornAfter, bornBy, ruleMessage } from "./ruleMessage.ts";
import { SERVER_COPY } from "./serverCopy.ts";

import type { FLRefusedField } from "./generated/client/types.ts";

const { field, failure } = COPY.shared;

describe("the field patterns over the backend's rules", () => {
  const rule = (kind: string, ctx: FLRefusedField["ctx"] = {}) => ruleMessage({ kind, ctx });

  it("words each rule a pattern holds from the bound its context names, as the box's own check would", () => {
    const start = "2026-09-01";
    expect(rule("saison_ends_before_start", { start })).toStrictEqual({ field: field.earliest(start) });
    expect(rule("bewerbung_window_ends_before_start", { start })).toStrictEqual({ field: field.earliest(start) });
    expect(rule("spieltag_ends_before_start", { start })).toStrictEqual({ field: field.earliest(start) });
    expect(rule("good_spieler_exceed_kader", { max: 8 })).toStrictEqual({ field: field.max(8) });
    for (const kind of ["ergebnis_missing_tore", "decline_without_proposal", "decline_without_reason"]) {
      expect(rule(kind), kind).toStrictEqual({ field: field.required });
    }
    expect(rule("email_not_accepted")).toStrictEqual({ field: field.format(field.exampleAddress) });
    expect(rule("date_not_in_calendar")).toStrictEqual({ field: field.format(field.exampleDate) });
    expect(rule("url_not_accepted")).toStrictEqual({ field: field.format(field.exampleUrl) });
    expect(rule("address_in_free_text")).toStrictEqual({ field: field.without(COPY.signIn.address) });
    // A repeat across the contact block reads as the field pattern alone, never with the field's name before it.
    expect(rule("kontakt_email_twice")).toStrictEqual({ field: field.taken });
    expect(rule("kontakt_telefon_twice")).toStrictEqual({ field: field.taken });
    expect(rule("nichtantreten_with_tore")).toStrictEqual({ field: field.without(COPY.shared.tore) });
    expect(rule("nichtantreten_with_torschuetzen")).toStrictEqual({ field: field.without(COPY.admin.spiel.torschuetzen) });
  });

  // The harm: the server moves its age floor, and the box names a day the write no longer admits.
  it("words a refused age as the latest birthdate the floor the refusal carries admits, by Berlin's day", () => {
    vi.useFakeTimers({ now: new Date("2026-11-04T23:30:00Z"), toFake: ["Date"] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    // Half past midnight on 5 November in Berlin, whose day the backend judges an age on.
    expect(rule("confirmation_age", { min: 16, max: 120 })).toStrictEqual({ field: field.latest(dayOf("2010-11-05")) });
    expect(rule("confirmation_age", { min: 18, max: 120 })).toStrictEqual({ field: field.latest(dayOf("2008-11-05")) });
  });

  it("takes the month's last day as the latest birthdate where that year holds no such day", () => {
    vi.useFakeTimers({ now: new Date("2028-02-29T12:00:00Z"), toFake: ["Date"] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    expect(bornBy(17)).toBe("2011-02-28");
    expect(bornAfter(120)).toBe("1907-03-01");
  });

  it("prints a season's year bounds with no thousands separator", () => {
    expect(rule("saison_year_out_of_range", { min: 2026, max: 2027 })).toStrictEqual({ field: field.between({ year: 2026 }, { year: 2027 }) });
    expect(field.between({ year: 2026 }, { year: 2027 })).toBe("Zwischen 2026 und 2027");
  });

  it("words a rule no pattern holds as its sentence on the status line, and anything else, a missing bound among it, as unexpected there", () => {
    expect(rule("elfmeterschiessen_without_draw")).toStrictEqual({ line: SERVER_COPY.ruleLine.elfmeterschiessen_without_draw });
    expect(rule("good_spieler_exceed_kader")).toStrictEqual({ line: failure.unexpected });
    expect(rule("string_too_long", { max_length: 80 })).toStrictEqual({ line: failure.unexpected });
  });
});
