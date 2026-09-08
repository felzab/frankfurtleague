import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FLPostSaisonPayloadSchema, FLSpielplanShapeSchema } from "@/features/saisons/schemas";

import { describeShapeRows, readShape, SHAPE_FIELDS, shapeCeiling } from "./spielplanShape.ts";

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

/**
 * The field this table's ceiling is a function of the other two for. Read back rather than assumed:
 * a reordering of the table would otherwise hand every case below the wrong row.
 */
const QUALIFIERS = SHAPE_FIELDS.find((field) => field.key === "qualifiers_per_group");
const GROUPS = SHAPE_FIELDS.find((field) => field.key === "number_of_groups");

/**
 * Whether a whole create carrying this shape parses. The PAYLOAD and not `FLSpielplanShapeSchema`:
 * `REQ-RULES-001` and `REQ-RULES-007` read two of the three numbers each, so they are refinements on
 * the season rather than bounds on a field, and the offer has to be held to them and not to itself.
 */
const saves = (next: FLSpielplanShape): boolean =>
  FLPostSaisonPayloadSchema.safeParse({
    id: "2026",
    start_date: "2025-09-01",
    end_date: "2026-06-30",
    bewerbung: { offen: true, von: "2025-05-01", bis: "2025-06-30" },
    rules: { ...STORED, ...next },
  }).success;

/** Every count the field offers, so a case reads the offer rather than a list beside it. */
const upTo = (ceiling: number): number[] => Array.from({ length: ceiling }, (_, index) => index + 1);

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
     schema's offers a number the parse refuses, and a ceiling above it hides nothing but does let
     the box display a value snapped off the one the payload carries. */
  it("bounds each field exactly where the schema does", () => {
    for (const { key, minValue, maxValue } of SHAPE_FIELDS) {
      const parse = (value: number) => FLSpielplanShapeSchema.safeParse({ ...shape(), [key]: value }).success;

      assert.equal(parse(minValue), true, `${key}: the field's floor is refused by the schema`);
      assert.equal(parse(minValue - 1), false, `${key}: the schema accepts a value below the field's floor`);
      assert.equal(parse(maxValue), true, `${key}: the field's ceiling is refused by the schema`);
      assert.equal(parse(maxValue + 1), false, `${key}: the schema accepts a value above the field's ceiling`);
    }
  });
});

describe("shapeCeiling", () => {
  /* The two fields no other number bounds. Cut either against a second rule here and the panel would
     hide a season that saves, which is the same defect as offering one that does not. */
  it("leaves a field the schema alone bounds where the schema put it", () => {
    for (const field of SHAPE_FIELDS.filter((entry) => entry.key !== "qualifiers_per_group")) {
      assert.equal(shapeCeiling(field, shape()), field.maxValue, field.key);
    }
  });

  /* The entry's own clearest instance. Return the schema's bound here and the stepper walks upward
     into a refusal an admin meets only after the press: what caps a qualifier count is the PRODUCT
     `REQ-RULES-001` judges and the group size `REQ-RULES-007` does, never the field's own ceiling. */
  it("offers the largest qualifier count the write path takes, and no more", () => {
    assert.ok(QUALIFIERS !== undefined && GROUPS !== undefined, "the table no longer names both counts");

    for (const groups of upTo(GROUPS.maxValue)) {
      for (const teams of [2, 3, 4, 8, 16]) {
        const held = shape({ number_of_groups: groups, teams_per_group: teams, qualifiers_per_group: 1 });
        const ceiling = shapeCeiling(QUALIFIERS, held);

        // A group count no product reaches -- `REQ-RULES-001` admits only the powers of two -- has no
        // legal qualifier count at all, so the ceiling is judged only where one exists.
        if (!upTo(QUALIFIERS.maxValue).some((count) => saves({ ...held, qualifiers_per_group: count }))) continue;

        assert.equal(saves({ ...held, qualifiers_per_group: ceiling }), true, `${groups} groups of ${teams}: the ceiling is refused`);
        assert.equal(saves({ ...held, qualifiers_per_group: ceiling + 1 }), false, `${groups} groups of ${teams}: one past the ceiling saves`);
      }
    }
  });

  /* Never below the value the draft holds: react-stately snaps a controlled value into the range
     before rendering it and calls no handler, so the box would show a figure the payload does not
     carry. A stored excess re-sent unchanged is a save the write path takes. */
  it("keeps a stored excess reachable rather than snapping the box off it", () => {
    assert.ok(QUALIFIERS !== undefined, "the table no longer names the qualifier count");

    const excessive = shape({ number_of_groups: 4, teams_per_group: 2, qualifiers_per_group: 9 });

    assert.equal(shapeCeiling(QUALIFIERS, excessive), 9);
  });

  /* The claim a stepper cannot state: the legal group counts SKIP, so a floor and a ceiling describe
     them only by admitting values between them that no season can be saved with. */
  it("stands over a group offer that is not an interval", () => {
    assert.ok(QUALIFIERS !== undefined && GROUPS !== undefined, "the table no longer names both counts");

    const reachable = upTo(GROUPS.maxValue).filter((groups) =>
      upTo(QUALIFIERS.maxValue).some((count) =>
        saves(shape({ number_of_groups: groups, teams_per_group: QUALIFIERS.maxValue, qualifiers_per_group: count })),
      ),
    );

    assert.ok(reachable.length > 0, "no group count at all can be saved");
    // Exactly the powers of two, every other factor of a product being one that cannot cancel.
    assert.deepEqual(
      reachable,
      upTo(Math.max(...reachable)).filter((groups) => (groups & (groups - 1)) === 0),
    );
    // Named so the gap is asserted and not merely implied: it stands between two counts on offer.
    assert.deepEqual(
      [2, 3, 4].map((groups) => reachable.includes(groups)),
      [true, false, true],
    );
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
