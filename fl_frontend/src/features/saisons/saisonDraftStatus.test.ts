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
    tiebreak_order: "tordifferenz",
    max_kadergroesse: 50,
    forfeit_ergebnis: { sieger_tore: 3, verlierer_tore: 0 },
    erlaubte_stufen: ["E1", "E2", "Q1", "Q2"],
  },
  bewerbung: { offen: true, von: "2025-05-01", bis: "2025-06-30" },
};

const draftFrom = (overrides: Partial<SaisonDraftFields>): SaisonDraftFields => ({ ...stored, ...overrides });

const rules = (overrides: Partial<SaisonDraftFields["rules"]>): Partial<SaisonDraftFields> => ({
  rules: { ...stored.rules, ...overrides },
});

describe("deriveSaisonDraftStatus", () => {
  it("carries a row for every season field", () => {
    const status = deriveSaisonDraftStatus({ stored, draft: draftFrom({}), fieldErrors: {} });

    // `status` is deliberately not a field: the rollover is a control, never a draft the bar counts.
    assert.equal(status.fields.length, 12);
  });

  it("reads the tiebreak as its German name, so the change list and the picker agree", () => {
    const status = deriveSaisonDraftStatus({
      stored,
      draft: draftFrom(rules({ tiebreak_order: "direkter_vergleich" })),
      fieldErrors: {},
    });

    const row = status.byPath.get("rules.tiebreak_order");
    assert.ok(row?.isChanged);
    assert.equal(row.storedText, "Tordifferenz");
    assert.equal(row.draftText, "Direkter Vergleich");
  });

  it("reports the forfeit result as one row over both sides, not one per number", () => {
    const status = deriveSaisonDraftStatus({
      stored,
      draft: draftFrom(rules({ forfeit_ergebnis: { sieger_tore: 2, verlierer_tore: 0 } })),
      fieldErrors: {},
    });

    assert.equal(status.changed.length, 1);
    assert.deepEqual(
      status.changed.map((field) => [field.path, field.storedText, field.draftText]),
      [["rules.forfeit_ergebnis", "3:0", "2:0"]],
    );
  });

  it("lands a forfeit field's own error on the pair's single row, which is the only row rendering it", () => {
    const status = deriveSaisonDraftStatus({
      stored,
      draft: draftFrom({}),
      fieldErrors: { "rules.forfeit_ergebnis.verlierer_tore": "Der Verlierer bekommt 0 oder mehr Tore." },
    });

    assert.equal(status.byPath.get("rules.forfeit_ergebnis")?.error, "Der Verlierer bekommt 0 oder mehr Tore.");
  });

  it("never offers a row for status or id, whatever the draft holds", () => {
    const status = deriveSaisonDraftStatus({ stored, draft: draftFrom({}), fieldErrors: {} });

    assert.equal(status.byPath.get("status"), undefined);
    assert.equal(status.byPath.get("id"), undefined);
  });

  it("reports a moved end date as one change carrying both texts", () => {
    const status = deriveSaisonDraftStatus({ stored, draft: draftFrom({ end_date: "2026-07-15" }), fieldErrors: {} });

    assert.deepEqual(
      status.changed.map((field) => [field.path, field.storedText, field.draftText]),
      [["end_date", "2026-06-30", "2026-07-15"]],
    );
  });

  it("reports a points change under its own dotted path, so the label and the error agree", () => {
    const status = deriveSaisonDraftStatus({ stored, draft: draftFrom(rules({ win_points: 2 })), fieldErrors: {} });

    const row = status.byPath.get("rules.win_points");
    // The digits, the dotted path and the `Regeln` group are all this table's, so only a case over
    // this table can pin them.
    assert.ok(row);
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
    // `draftText: null` renders the row as a removal; the schema refuses it on save.
    assert.equal(row.draftText, null);
    assert.equal(row.storedText, "E1, E2, Q1, Q2");
  });

  it("carries a field error onto its own row", () => {
    const status = deriveSaisonDraftStatus({
      stored,
      draft: draftFrom(rules({ number_of_groups: 9 })),
      fieldErrors: { "rules.number_of_groups": "Es gibt höchstens 4 Gruppen." },
    });

    // The descriptor's default `errorPaths`, which is this table's: widen it and the message
    // answers on a path no input carries.
    assert.equal(status.byPath.get("rules.number_of_groups")?.error, "Es gibt höchstens 4 Gruppen.");
  });

  it("reports the whole application window as one row, freischaltung included", () => {
    const status = deriveSaisonDraftStatus({
      stored,
      draft: draftFrom({ bewerbung: { offen: false, von: "2025-05-01", bis: "2025-06-30" } }),
      fieldErrors: {},
    });

    assert.equal(status.changed.length, 1);
    const row = status.byPath.get("bewerbung");
    assert.equal(row?.group, "Bewerbung");
    assert.equal(row?.storedText, "Freigeschaltet: 01.05.2025 bis 30.06.2025");
    assert.equal(row?.draftText, "Gesperrt: 01.05.2025 bis 30.06.2025");
  });

  it("treats a closed window as a removal, which is what the change list should show", () => {
    const status = deriveSaisonDraftStatus({ stored, draft: draftFrom({ bewerbung: null }), fieldErrors: {} });

    const row = status.byPath.get("bewerbung");
    assert.ok(row?.isChanged);
    assert.equal(row.draftText, null);
  });

  it("lands one date's own error on the window's single row, which is the only row rendering it", () => {
    const status = deriveSaisonDraftStatus({
      stored,
      draft: draftFrom({ bewerbung: { offen: true, von: "2025-05-01", bis: "" } }),
      fieldErrors: { "bewerbung.bis": "Bitte gib ein gültiges Datum ein." },
    });

    assert.equal(status.byPath.get("bewerbung")?.error, "Bitte gib ein gültiges Datum ein.");
  });

  it("counts several changes across both groups, in the descriptor table's order", () => {
    const status = deriveSaisonDraftStatus({
      stored,
      draft: { ...draftFrom({ start_date: "2025-09-08" }), ...rules({ teams_per_group: 6 }) },
      fieldErrors: {},
    });

    assert.deepEqual(
      status.changed.map((field) => field.group),
      ["Zeitraum", "Regeln"],
    );
  });
});
