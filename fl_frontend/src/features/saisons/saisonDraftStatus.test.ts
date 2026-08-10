import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveSaisonDraftStatus } from "./saisonDraftStatus";

import type { SaisonDraftFields } from "./types";

const stored: SaisonDraftFields = {
  start_date: "2025-09-01",
  end_date: "2026-06-30",
  rules: {
    win_points: 3,
    draw_points: 1,
    qualifiers_per_group: 2,
    number_of_groups: 2,
    teams_per_group: 5,
    erlaubte_stufen: ["E1", "E2", "Q1", "Q2"],
  },
};

const draftFrom = (overrides: Partial<SaisonDraftFields>): SaisonDraftFields => ({ ...stored, ...overrides });

const rules = (overrides: Partial<SaisonDraftFields["rules"]>): Partial<SaisonDraftFields> => ({
  rules: { ...stored.rules, ...overrides },
});

describe("deriveSaisonDraftStatus", () => {
  it("reports a clean draft as not dirty, with every field present", () => {
    const status = deriveSaisonDraftStatus({ stored, draft: draftFrom({}), fieldErrors: {} });

    assert.equal(status.isDirty, false);
    assert.equal(status.changed.length, 0);
    // Two dates plus the six fields of `rules`. `status` is deliberately not one: the rollover is a
    // control writing through its own endpoint, never a draft the save bar counts (ADR-0026).
    assert.equal(status.fields.length, 8);
  });

  it("never offers a row for status or id, whatever the draft holds", () => {
    const status = deriveSaisonDraftStatus({ stored, draft: draftFrom({}), fieldErrors: {} });

    assert.equal(status.byPath.get("status"), undefined);
    assert.equal(status.byPath.get("id"), undefined);
  });

  it("reports a moved end date as one change carrying both texts", () => {
    const status = deriveSaisonDraftStatus({ stored, draft: draftFrom({ end_date: "2026-07-15" }), fieldErrors: {} });

    assert.equal(status.isDirty, true);
    assert.deepEqual(
      status.changed.map((field) => [field.path, field.storedText, field.draftText]),
      [["end_date", "2026-06-30", "2026-07-15"]],
    );
  });

  it("reports a points change under its own dotted path, so the label and the error agree", () => {
    const status = deriveSaisonDraftStatus({ stored, draft: draftFrom(rules({ win_points: 2 })), fieldErrors: {} });

    const row = status.byPath.get("rules.win_points");
    assert.ok(row?.isChanged);
    assert.equal(row.storedText, "3");
    assert.equal(row.draftText, "2");
    assert.equal(row.group, "Regeln");
  });

  it("reads the allowed levels in the league's order, so reordering the same set is not a change", () => {
    const status = deriveSaisonDraftStatus({
      stored,
      draft: draftFrom(rules({ erlaubte_stufen: ["Q2", "E1", "Q1", "E2"] })),
      fieldErrors: {},
    });

    assert.equal(status.isDirty, false);
    assert.equal(status.byPath.get("rules.erlaubte_stufen")?.draftText, "E1, E2, Q1, Q2");
  });

  it("reports an added level as a change and reads it in sequence rather than at the end", () => {
    const status = deriveSaisonDraftStatus({
      stored,
      draft: draftFrom(rules({ erlaubte_stufen: ["E1", "E2", "Q1", "Q2", "Q3"] })),
      fieldErrors: {},
    });

    assert.equal(status.byPath.get("rules.erlaubte_stufen")?.draftText, "E1, E2, Q1, Q2, Q3");
  });

  it("treats an emptied level list as a removal, which is what the change list should show", () => {
    const status = deriveSaisonDraftStatus({ stored, draft: draftFrom(rules({ erlaubte_stufen: [] })), fieldErrors: {} });

    const row = status.byPath.get("rules.erlaubte_stufen");
    assert.ok(row?.isChanged);
    // `draftText: null` is what makes the change list render this as a removal; the schema refuses it
    // on save, so the row and the field error say the same thing about the same draft.
    assert.equal(row.draftText, null);
    assert.equal(row.storedText, "E1, E2, Q1, Q2");
  });

  it("carries a field error onto its own row and into invalid", () => {
    const status = deriveSaisonDraftStatus({
      stored,
      draft: draftFrom(rules({ number_of_groups: 9 })),
      fieldErrors: { "rules.number_of_groups": "Es gibt höchstens 4 Gruppen." },
    });

    assert.equal(status.byPath.get("rules.number_of_groups")?.error, "Es gibt höchstens 4 Gruppen.");
    assert.deepEqual(
      status.invalid.map((field) => field.path),
      ["rules.number_of_groups"],
    );
  });

  it("counts several changes across both groups, in the descriptor table's order", () => {
    const status = deriveSaisonDraftStatus({
      stored,
      draft: { ...draftFrom({ start_date: "2025-09-08" }), ...rules({ teams_per_group: 6 }) },
      fieldErrors: {},
    });

    assert.equal(status.changed.length, 2);
    assert.deepEqual(
      status.changed.map((field) => field.group),
      ["Zeitraum", "Regeln"],
    );
  });
});
