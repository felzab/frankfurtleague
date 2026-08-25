import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FLSpielplanShapeSchema } from "@/features/saisons/schemas";

import { describeShapeRows, readShape, SHAPE_FIELDS } from "./spielplanShape.ts";

import type { FLSaisonRules, FLSpielplanShape } from "@/features/saisons/schemas";

const STORED: FLSaisonRules = {
  win_points: 3,
  draw_points: 1,
  qualifiers_per_group: 2,
  number_of_groups: 2,
  teams_per_group: 6,
  tiebreak_order: "tordifferenz",
  max_kadergroesse: 12,
  forfeit_ergebnis: { sieger_tore: 3, verlierer_tore: 0 },
  erlaubte_stufen: ["E1"],
};

const shape = (overrides: Partial<FLSpielplanShape> = {}): FLSpielplanShape => ({ ...readShape(STORED), ...overrides });

/** One row by its key, so a reordering of the table cannot silently rename what a case asserts. */
const rowFor = (key: keyof FLSpielplanShape, next: FLSpielplanShape) =>
  describeShapeRows(readShape(STORED), next).find((row) => row.key === key);

describe("readShape", () => {
  /* Reach for the whole `rules` object instead and this fails: the draw's payload carries these
     three alone, and the rest of the rules shaped no fixture and have `PATCH` as their only writer. */
  it("takes the three the fixtures are a function of, and nothing else", () => {
    assert.deepEqual(readShape(STORED), { number_of_groups: 2, teams_per_group: 6, qualifiers_per_group: 2 });
  });
});

describe("SHAPE_FIELDS", () => {
  /* Every one of the three, in the order the panel offers them. Drop one and the payload carries a
     number nobody chose; `FLSpielplanShape` is all three or none. */
  it("offers each of the three the payload carries", () => {
    assert.deepEqual(
      SHAPE_FIELDS.map((field) => field.key),
      ["number_of_groups", "teams_per_group", "qualifiers_per_group"],
    );
  });

  /* Drift either bound and this fails. The field is what an admin can reach, so a floor below the
     schema's offers a number the parse refuses, and a floor above it hides a legal season. */
  it("bounds each field exactly where the schema does", () => {
    for (const { key, minValue, maxValue } of SHAPE_FIELDS) {
      const parse = (value: number) => FLSpielplanShapeSchema.safeParse({ ...shape(), [key]: value }).success;

      assert.equal(parse(minValue), true, `${key}: the field's floor is refused by the schema`);
      assert.equal(parse(minValue - 1), false, `${key}: the schema accepts a value below the field's floor`);

      if (maxValue === undefined) continue;
      assert.equal(parse(maxValue), true, `${key}: the field's ceiling is refused by the schema`);
      assert.equal(parse(maxValue + 1), false, `${key}: the schema accepts a value above the field's ceiling`);
    }
  });

  /* A field left unbounded above where the schema bounds it lets an admin type a season the parse
     then refuses, which is the same defect the case above catches from the other side. */
  it("leaves a field open above only where the schema does", () => {
    for (const { key, maxValue } of SHAPE_FIELDS) {
      if (maxValue !== undefined) continue;
      // 99 is past every ceiling the three carry, so a schema bound would show up here.
      assert.equal(FLSpielplanShapeSchema.safeParse({ ...shape(), [key]: 99 }).success, true, `${key}: the schema bounds an open field`);
    }
  });
});

describe("describeShapeRows", () => {
  /* State the new number alone and this fails: the redraw STORES it, so a readout that shows only
     where the season lands lets an admin confirm a rules change they were never shown. */
  it("states a moved number from and to", () => {
    assert.deepEqual(rowFor("number_of_groups", shape({ number_of_groups: 4 })), {
      key: "number_of_groups",
      label: "Gruppen",
      value: "von 2 auf 4",
      isChanged: true,
    });
  });

  /* An unmoved number reads as itself. Render every row as a move and a first-press redraw would
     claim the season's shape changed when the press leaves all three where they are. */
  it("states an unmoved number as one figure", () => {
    const row = rowFor("teams_per_group", shape());

    assert.equal(row?.value, "6");
    assert.equal(row?.isChanged, false);
  });

  /* One row per rule, always, in the table's order: a list that drops the unmoved rows would leave
     the confirmation naming a shape it has not stated in full. */
  it("returns a row for each of the three whatever moved", () => {
    const rows = describeShapeRows(readShape(STORED), shape({ qualifiers_per_group: 1 }));

    assert.deepEqual(
      rows.map((row) => row.key),
      SHAPE_FIELDS.map((field) => field.key),
    );
    assert.deepEqual(
      rows.map((row) => row.isChanged),
      [false, false, true],
    );
  });

  /* The labels are the panel's own, and the fields above the readout carry the same ones. Split the
     two and the confirmation names a number by a heading no input on the page uses. */
  it("labels each row from the table the fields are built from", () => {
    assert.deepEqual(
      describeShapeRows(readShape(STORED), shape()).map((row) => row.label),
      SHAPE_FIELDS.map((field) => field.label),
    );
  });
});
