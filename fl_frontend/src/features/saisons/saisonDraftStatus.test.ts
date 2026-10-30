import { saisonRules } from "@/test-support/saisonRules.ts";
import { assert, describe, expect, it } from "vitest";

import { deriveSaisonDraftStatus } from "./saisonDraftStatus";

import type { SaisonDraftFields } from "./types";

const stored: SaisonDraftFields = {
  start_date: "2025-09-01",
  end_date: "2026-06-30",
  rules: saisonRules({ teams_per_group: 5, max_kadergroesse: 50, erlaubte_stufen: ["E1", "E2", "Q1", "Q2"] }),
  bewerbung: { offen: true, von: "2025-05-01", bis: "2025-06-30" },
  registrierung: { offen: true, von: "2025-07-01", bis: "2025-08-15" },
};

const draftFrom = (overrides: Partial<SaisonDraftFields>): SaisonDraftFields => ({ ...stored, ...overrides });

const rules = (overrides: Partial<SaisonDraftFields["rules"]>): Partial<SaisonDraftFields> => ({
  rules: { ...stored.rules, ...overrides },
});

describe("deriveSaisonDraftStatus", () => {
  it("carries a row for every season field", () => {
    const status = deriveSaisonDraftStatus({ stored, draft: draftFrom({}), fieldErrors: {} });

    // `status` is deliberately not a field: the rollover is a control, never a draft the bar counts.
    expect(status.fields.length).toBe(13);
  });

  it("reads the tiebreak as its German name, so the change list and the picker agree", () => {
    const status = deriveSaisonDraftStatus({
      stored,
      draft: draftFrom(rules({ tiebreak_order: "direkter_vergleich" })),
      fieldErrors: {},
    });

    const row = status.byPath.get("rules.tiebreak_order");
    assert.ok(row?.isChanged);
    expect(row.storedText).toBe("Tordifferenz");
    expect(row.draftText).toBe("Direkter Vergleich");
  });

  it("reports the forfeit result as one row over both sides, not one per number", () => {
    const status = deriveSaisonDraftStatus({
      stored,
      draft: draftFrom(rules({ forfeit_ergebnis: { sieger_tore: 2, verlierer_tore: 0 } })),
      fieldErrors: {},
    });

    expect(status.changed.length).toBe(1);
    expect(status.changed.map((field) => [field.path, field.storedText, field.draftText])).toStrictEqual([
      ["rules.forfeit_ergebnis", "3:0", "2:0"],
    ]);
  });

  it("lands a forfeit field's own error on the pair's single row, which is the only row rendering it", () => {
    const status = deriveSaisonDraftStatus({
      stored,
      draft: draftFrom({}),
      fieldErrors: { "rules.forfeit_ergebnis.verlierer_tore": "Der Verlierer bekommt 0 oder mehr Tore." },
    });

    expect(status.byPath.get("rules.forfeit_ergebnis")?.error).toBe("Der Verlierer bekommt 0 oder mehr Tore.");
  });

  it("never offers a row for status or id, whatever the draft holds", () => {
    const status = deriveSaisonDraftStatus({ stored, draft: draftFrom({}), fieldErrors: {} });

    expect(status.byPath.get("status")).toBe(undefined);
    expect(status.byPath.get("id")).toBe(undefined);
  });

  it("reports a moved end date as one change carrying both texts", () => {
    const status = deriveSaisonDraftStatus({ stored, draft: draftFrom({ end_date: "2026-07-15" }), fieldErrors: {} });

    expect(status.changed.map((field) => [field.path, field.storedText, field.draftText])).toStrictEqual([
      ["end_date", "2026-06-30", "2026-07-15"],
    ]);
  });

  it("reports a points change under its own dotted path, so the label and the error agree", () => {
    const status = deriveSaisonDraftStatus({ stored, draft: draftFrom(rules({ win_points: 2 })), fieldErrors: {} });

    const row = status.byPath.get("rules.win_points");
    // The digits, the dotted path and the `Regeln` group are all this table's, so only a case over
    // this table can pin them.
    assert.ok(row);
    expect(row.storedText).toBe("3");
    expect(row.draftText).toBe("2");
    expect(row.group).toBe("Regeln");
  });

  it("reads the allowed levels in the league's order, so reordering the same set is not a change", () => {
    const status = deriveSaisonDraftStatus({
      stored,
      draft: draftFrom(rules({ erlaubte_stufen: ["Q2", "E1", "Q1", "E2"] })),
      fieldErrors: {},
    });

    expect(status.isDirty).toBe(false);
    expect(status.byPath.get("rules.erlaubte_stufen")?.draftText).toBe("E1, E2, Q1, Q2");
  });

  it("reports an added level as a change and reads it in sequence rather than at the end", () => {
    const status = deriveSaisonDraftStatus({
      stored,
      draft: draftFrom(rules({ erlaubte_stufen: ["E1", "E2", "Q1", "Q2", "Q3"] })),
      fieldErrors: {},
    });

    expect(status.byPath.get("rules.erlaubte_stufen")?.draftText).toBe("E1, E2, Q1, Q2, Q3");
  });

  it("treats an emptied level list as a removal, which is what the change list should show", () => {
    const status = deriveSaisonDraftStatus({ stored, draft: draftFrom(rules({ erlaubte_stufen: [] })), fieldErrors: {} });

    const row = status.byPath.get("rules.erlaubte_stufen");
    assert.ok(row?.isChanged);
    // `draftText: null` renders the row as a removal; the schema refuses it on save.
    expect(row.draftText).toBe(null);
    expect(row.storedText).toBe("E1, E2, Q1, Q2");
  });

  it("carries a field error onto its own row", () => {
    // `rules_gruppen_in_use`'s own sentence, against the narrowing that raises it: a fixture stating a
    // ceiling of its own reads as false to anyone who checks what the group offer admits.
    const groupHoldsTeams = "Eine Gruppe, die noch Teams hält, kann nicht wegfallen.";
    const status = deriveSaisonDraftStatus({
      stored,
      draft: draftFrom(rules({ number_of_groups: 1 })),
      fieldErrors: { "rules.number_of_groups": groupHoldsTeams },
    });

    // The descriptor's default `errorPaths`, which is this table's: widen it and the message
    // answers on a path no input carries.
    expect(status.byPath.get("rules.number_of_groups")?.error).toBe(groupHoldsTeams);
  });

  it("reports the whole application window as one row, freischaltung included", () => {
    const status = deriveSaisonDraftStatus({
      stored,
      draft: draftFrom({ bewerbung: { offen: false, von: "2025-05-01", bis: "2025-06-30" } }),
      fieldErrors: {},
    });

    expect(status.changed.length).toBe(1);
    const row = status.byPath.get("bewerbung");
    expect(row?.group).toBe("Bewerbung");
    expect(row?.storedText).toBe("Freigeschaltet: 01.05.2025 bis 30.06.2025");
    expect(row?.draftText).toBe("Gesperrt: 01.05.2025 bis 30.06.2025");
  });

  it("treats a closed window as a removal, which is what the change list should show", () => {
    const status = deriveSaisonDraftStatus({ stored, draft: draftFrom({ bewerbung: null }), fieldErrors: {} });

    const row = status.byPath.get("bewerbung");
    assert.ok(row?.isChanged);
    expect(row.draftText).toBe(null);
  });

  it("lands one date's own error on the window's single row, which is the only row rendering it", () => {
    const status = deriveSaisonDraftStatus({
      stored,
      draft: draftFrom({ bewerbung: { offen: true, von: "2025-05-01", bis: "" } }),
      fieldErrors: { "bewerbung.bis": "Bitte gib ein gültiges Datum ein." },
    });

    expect(status.byPath.get("bewerbung")?.error).toBe("Bitte gib ein gültiges Datum ein.");
  });

  it("reports the registration window as its own row, so closing one window leaves the other alone", () => {
    const status = deriveSaisonDraftStatus({
      stored,
      draft: draftFrom({ registrierung: null }),
      fieldErrors: {},
    });

    expect(status.changed.length).toBe(1);
    const row = status.byPath.get("registrierung");
    expect(row?.group).toBe("Registrierung");
    expect(row?.storedText).toBe("Freigeschaltet: 01.07.2025 bis 15.08.2025");
    expect(row?.draftText).toBe(null);
    expect(status.byPath.get("bewerbung")?.isChanged).toBe(false);
  });

  it("lands one registration date's own error on that window's single row", () => {
    const status = deriveSaisonDraftStatus({
      stored,
      draft: draftFrom({ registrierung: { offen: true, von: "2025-07-01", bis: "" } }),
      fieldErrors: { "registrierung.bis": "Bitte gib ein gültiges Datum ein." },
    });

    expect(status.byPath.get("registrierung")?.error).toBe("Bitte gib ein gültiges Datum ein.");
  });

  it("counts several changes across both groups, in the descriptor table's order", () => {
    const status = deriveSaisonDraftStatus({
      stored,
      draft: { ...draftFrom({ start_date: "2025-09-08" }), ...rules({ teams_per_group: 6 }) },
      fieldErrors: {},
    });

    expect(status.changed.map((field) => field.group)).toStrictEqual(["Zeitraum", "Regeln"]);
  });
});
