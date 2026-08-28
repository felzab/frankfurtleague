import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FLPatchSaisonPayloadSchema, FLPostSaisonPayloadSchema } from "./schemas";

const rules = {
  win_points: 3,
  draw_points: 1,
  qualifiers_per_group: 2,
  number_of_groups: 4,
  teams_per_group: 4,
  tiebreak_order: "tordifferenz",
  max_kadergroesse: 50,
  forfeit_ergebnis: { sieger_tore: 3, verlierer_tore: 0 },
  erlaubte_stufen: ["E1", "E2", "Q1", "Q2"],
};

const create = (overrides: Partial<typeof rules> = {}) => ({
  id: "2026",
  start_date: "2025-09-01",
  end_date: "2026-06-30",
  // Present on every case: the key is required with no default, so leaving it out would refuse each
  // payload below on `bewerbung` and tell nobody which rule was under test.
  bewerbung: { offen: true, von: "2025-05-01", bis: "2025-06-30" },
  rules: { ...rules, ...overrides },
});

/** Every path a failure names, so a case asserts WHICH field the message lands under. */
const pathsRefused = (schema: typeof FLPostSaisonPayloadSchema | typeof FLPatchSaisonPayloadSchema, value: unknown): string[] => {
  const result = schema.safeParse(value);

  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
};

describe("FLPostSaisonPayloadSchema", () => {
  it("takes rules a create can satisfy", () => {
    assert.deepEqual(pathsRefused(FLPostSaisonPayloadSchema, create()), []);
  });

  it("refuses a group qualifying more teams than it holds", () => {
    // 2 x 4 is 8, a bracket that pairs down, so this case reaches the over-qualify rule alone.
    assert.deepEqual(pathsRefused(FLPostSaisonPayloadSchema, create({ number_of_groups: 2, qualifiers_per_group: 4, teams_per_group: 2 })), [
      "rules.qualifiers_per_group",
    ]);
  });

  it("takes a group that qualifies every team it holds, a seeding-only group stage being a real format", () => {
    assert.deepEqual(pathsRefused(FLPostSaisonPayloadSchema, create({ qualifiers_per_group: 2, teams_per_group: 2 })), []);
  });

  it("refuses a field that pairs down to no bracket", () => {
    assert.deepEqual(pathsRefused(FLPostSaisonPayloadSchema, create({ number_of_groups: 3, qualifiers_per_group: 1, teams_per_group: 4 })), [
      "rules.qualifiers_per_group",
    ]);
  });

  it("refuses a group too small to generate a fixture, and one past the list read's cap", () => {
    // A qualifier each, so a group of one reaches the size bound alone rather than the over-qualify rule.
    assert.deepEqual(pathsRefused(FLPostSaisonPayloadSchema, create({ qualifiers_per_group: 1, teams_per_group: 1 })), [
      "rules.teams_per_group",
    ]);
    assert.deepEqual(pathsRefused(FLPostSaisonPayloadSchema, create({ teams_per_group: 17 })), ["rules.teams_per_group"]);
  });

  it("names each side of the forfeit result on its own path, so the message lands under its own box", () => {
    assert.deepEqual(pathsRefused(FLPostSaisonPayloadSchema, create({ forfeit_ergebnis: { sieger_tore: -1, verlierer_tore: -1 } })), [
      "rules.forfeit_ergebnis.sieger_tore",
      "rules.forfeit_ergebnis.verlierer_tore",
    ]);
  });

  it("refuses a tiebreak outside the closed set the backend spells as a Literal", () => {
    assert.deepEqual(pathsRefused(FLPostSaisonPayloadSchema, create({ tiebreak_order: "losentscheid" })), ["rules.tiebreak_order"]);
  });

  it("refuses an end date before its start", () => {
    assert.deepEqual(pathsRefused(FLPostSaisonPayloadSchema, { ...create(), end_date: "2024-01-01" }), ["end_date"]);
  });

  it("demands the application window as a key, so an omitted one cannot pass for a closed season", () => {
    const { bewerbung: _dropped, ...withoutWindow } = create();

    assert.deepEqual(pathsRefused(FLPostSaisonPayloadSchema, withoutWindow), ["bewerbung"]);
  });

  it("takes an explicit null, which is the season that accepts no applications at all", () => {
    assert.deepEqual(pathsRefused(FLPostSaisonPayloadSchema, { ...create(), bewerbung: null }), []);
  });
});

describe("FLPatchSaisonPayloadSchema", () => {
  it("takes rules that already breach either rule, so a dates-only edit reaches the server", () => {
    /* Both breaches at once. Each turns on the step from the stored rules, which this payload does not
       carry, so judging them here would refuse the repair (`docs/backend/spec.md :: I44`). */
    const breaching = { ...create({ number_of_groups: 3, qualifiers_per_group: 5, teams_per_group: 4 }), start_date: "2025-10-01" };

    assert.deepEqual(pathsRefused(FLPatchSaisonPayloadSchema, breaching), []);
  });

  it("still refuses an end date before its start, which the payload does judge alone", () => {
    assert.deepEqual(pathsRefused(FLPatchSaisonPayloadSchema, { ...create(), end_date: "2024-01-01" }), ["end_date"]);
  });

  it("refuses a window that ends before it opens, under the field the admin has to fix", () => {
    const reversed = { ...create(), bewerbung: { offen: true, von: "2025-06-30", bis: "2025-05-01" } };

    assert.deepEqual(pathsRefused(FLPatchSaisonPayloadSchema, reversed), ["bewerbung.bis"]);
  });

  it("judges the window apart from the season, so one may open long before the season starts", () => {
    const early = { ...create(), bewerbung: { offen: false, von: "2024-01-01", bis: "2024-02-01" } };

    assert.deepEqual(pathsRefused(FLPatchSaisonPayloadSchema, early), []);
  });

  it("names each empty date of a half-entered window, which is what the panel renders on the field", () => {
    const halfEntered = { ...create(), bewerbung: { offen: false, von: "", bis: "" } };

    assert.deepEqual(pathsRefused(FLPatchSaisonPayloadSchema, halfEntered), ["bewerbung.von", "bewerbung.bis"]);
  });
});
