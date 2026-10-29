import { saisonRules } from "@/test-support/saisonRules.ts";
import { describe, expect, it } from "vitest";

import { FLPatchSaisonPayloadSchema, FLPostSaisonPayloadSchema } from "./schemas";

import type { FLSaisonRules } from "./schemas";

const rules = saisonRules({ number_of_groups: 4, max_kadergroesse: 50, erlaubte_stufen: ["E1", "E2", "Q1", "Q2"] });

// Any value under a rule's key: the cases hand the schema what it refuses.
const create = (overrides: Partial<Record<keyof FLSaisonRules, unknown>> = {}) => ({
  id: "2026",
  start_date: "2025-09-01",
  end_date: "2026-06-30",
  // Present on every case: each key is required with no default, so leaving one out would refuse
  // each payload below on that window and tell nobody which rule was under test.
  bewerbung: { offen: true, von: "2025-05-01", bis: "2025-06-30" },
  registrierung: { offen: true, von: "2025-07-01", bis: "2025-08-15" },
  rules: { ...rules, ...overrides },
});

/** Every path a failure names, so a case asserts WHICH field the message lands under. */
const pathsRefused = (schema: typeof FLPostSaisonPayloadSchema | typeof FLPatchSaisonPayloadSchema, value: unknown): string[] => {
  const result = schema.safeParse(value);

  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
};

const messagesRefused = (schema: typeof FLPostSaisonPayloadSchema | typeof FLPatchSaisonPayloadSchema, value: unknown): string[] => {
  const result = schema.safeParse(value);

  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe("FLPostSaisonPayloadSchema", () => {
  it("takes rules a create can satisfy", () => {
    expect(pathsRefused(FLPostSaisonPayloadSchema, create())).toStrictEqual([]);
  });

  it("refuses a group qualifying more teams than it holds", () => {
    // 2 x 4 is 8, a bracket that pairs down, so this case reaches the over-qualify rule alone.
    expect(pathsRefused(FLPostSaisonPayloadSchema, create({ number_of_groups: 2, qualifiers_per_group: 4, teams_per_group: 2 }))).toStrictEqual(
      ["rules.qualifiers_per_group"],
    );
  });

  it("takes a group that qualifies every team it holds, a seeding-only group stage being a real format", () => {
    expect(pathsRefused(FLPostSaisonPayloadSchema, create({ qualifiers_per_group: 2, teams_per_group: 2 }))).toStrictEqual([]);
  });

  it("refuses a field that pairs down to no bracket", () => {
    expect(pathsRefused(FLPostSaisonPayloadSchema, create({ number_of_groups: 3, qualifiers_per_group: 1, teams_per_group: 4 }))).toStrictEqual(
      ["rules.qualifiers_per_group"],
    );
  });

  /* This is the one message that asks the reader to multiply, so each factor is named as its own panel
     labels it: a bare „Qualifikanten“ reads as the total across the season and is the wrong arithmetic. */
  it("names both factors of the bracket product the way the panel labels them", () => {
    const refused = messagesRefused(FLPostSaisonPayloadSchema, create({ number_of_groups: 3, qualifiers_per_group: 1, teams_per_group: 4 }));

    expect(refused.join(" ")).toMatch(/Die Zahl der Gruppen mal die Qualifikanten pro Gruppe/);
  });

  it("refuses a group too small to generate a fixture, and one past the list read's cap", () => {
    // A qualifier each, so a group of one reaches the size bound alone rather than the over-qualify rule.
    expect(pathsRefused(FLPostSaisonPayloadSchema, create({ qualifiers_per_group: 1, teams_per_group: 1 }))).toStrictEqual([
      "rules.teams_per_group",
    ]);
    expect(pathsRefused(FLPostSaisonPayloadSchema, create({ teams_per_group: 17 }))).toStrictEqual(["rules.teams_per_group"]);
  });

  it("names each side of the forfeit result on its own path, so the message lands under its own box", () => {
    expect(pathsRefused(FLPostSaisonPayloadSchema, create({ forfeit_ergebnis: { sieger_tore: -1, verlierer_tore: -1 } }))).toStrictEqual([
      "rules.forfeit_ergebnis.sieger_tore",
      "rules.forfeit_ergebnis.verlierer_tore",
    ]);
  });

  it("refuses a tiebreak outside the closed set the backend spells as a Literal", () => {
    expect(pathsRefused(FLPostSaisonPayloadSchema, create({ tiebreak_order: "losentscheid" }))).toStrictEqual(["rules.tiebreak_order"]);
  });

  it("refuses an end date before its start", () => {
    expect(pathsRefused(FLPostSaisonPayloadSchema, { ...create(), end_date: "2024-01-01" })).toStrictEqual(["end_date"]);
  });

  it("demands the application window as a key, so an omitted one cannot pass for a closed season", () => {
    const { bewerbung: _dropped, ...withoutWindow } = create();

    expect(pathsRefused(FLPostSaisonPayloadSchema, withoutWindow)).toStrictEqual(["bewerbung"]);
  });

  it("takes an explicit null, which is the season that accepts no applications at all", () => {
    expect(pathsRefused(FLPostSaisonPayloadSchema, { ...create(), bewerbung: null })).toStrictEqual([]);
  });

  it("demands the registration window as a key too, the create dialog sending the null it allows", () => {
    const { registrierung: _dropped, ...withoutWindow } = create();

    expect(pathsRefused(FLPostSaisonPayloadSchema, withoutWindow)).toStrictEqual(["registrierung"]);
  });

  it("takes an explicit null there as well, which is the season that takes no registrations", () => {
    expect(pathsRefused(FLPostSaisonPayloadSchema, { ...create(), registrierung: null })).toStrictEqual([]);
  });
});

describe("FLPatchSaisonPayloadSchema", () => {
  it("takes rules that already breach either rule, so a dates-only edit reaches the server", () => {
    /* Both breaches at once. Each turns on the step from the stored rules, which this payload does not
       carry, so judging them here would refuse the repair. */
    const breaching = { ...create({ number_of_groups: 3, qualifiers_per_group: 5, teams_per_group: 4 }), start_date: "2025-10-01" };

    expect(pathsRefused(FLPatchSaisonPayloadSchema, breaching)).toStrictEqual([]);
  });

  it("still refuses an end date before its start, which the payload does judge alone", () => {
    expect(pathsRefused(FLPatchSaisonPayloadSchema, { ...create(), end_date: "2024-01-01" })).toStrictEqual(["end_date"]);
  });

  it("refuses a window that ends before it opens, under the field the admin has to fix", () => {
    const reversed = { ...create(), bewerbung: { offen: true, von: "2025-06-30", bis: "2025-05-01" } };

    expect(pathsRefused(FLPatchSaisonPayloadSchema, reversed)).toStrictEqual(["bewerbung.bis"]);
  });

  it("judges the window apart from the season, so one may open long before the season starts", () => {
    const early = { ...create(), bewerbung: { offen: false, von: "2024-01-01", bis: "2024-02-01" } };

    expect(pathsRefused(FLPatchSaisonPayloadSchema, early)).toStrictEqual([]);
  });

  it("names each empty date of a half-entered window, which is what the panel renders on the field", () => {
    const halfEntered = { ...create(), bewerbung: { offen: false, von: "", bis: "" } };

    expect(pathsRefused(FLPatchSaisonPayloadSchema, halfEntered)).toStrictEqual(["bewerbung.von", "bewerbung.bis"]);
  });

  it("refuses a reversed registration window under its own field, so the two panels never share a message", () => {
    const reversed = { ...create(), registrierung: { offen: true, von: "2025-08-15", bis: "2025-07-01" } };

    expect(pathsRefused(FLPatchSaisonPayloadSchema, reversed)).toStrictEqual(["registrierung.bis"]);
  });

  it("words that refusal for the registration window rather than the application one", () => {
    const reversed = { ...create(), registrierung: { offen: true, von: "2025-08-15", bis: "2025-07-01" } };

    expect(messagesRefused(FLPatchSaisonPayloadSchema, reversed)).toStrictEqual([
      "Das Ende darf nicht vor dem Beginn der Registrierungsfrist liegen.",
    ]);
  });

  it("names each empty date of a half-entered registration window, as the application window's case does", () => {
    const halfEntered = { ...create(), registrierung: { offen: false, von: "", bis: "" } };

    expect(pathsRefused(FLPatchSaisonPayloadSchema, halfEntered)).toStrictEqual(["registrierung.von", "registrierung.bis"]);
  });

  it("judges the two windows apart, so one may run long after the other has closed", () => {
    const later = { ...create(), registrierung: { offen: true, von: "2026-01-01", bis: "2026-02-01" } };

    expect(pathsRefused(FLPatchSaisonPayloadSchema, later)).toStrictEqual([]);
  });
});
