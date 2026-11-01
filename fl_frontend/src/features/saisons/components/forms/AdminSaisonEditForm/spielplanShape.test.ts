import { saisonRules } from "@/test-support/saisonRules.ts";
import { describe, expect, it } from "vitest";

import { describeShapeRows, readShape, SHAPE_FIELDS } from "./spielplanShape.ts";

import type { FLSaisonRules, FLSpielplanShape } from "@/core/generated/client/types";

const STORED: FLSaisonRules = saisonRules({ teams_per_gruppe: 6, max_kadergroesse: 12, allowed_stufen: ["E1"] });

const shape = (overrides: Partial<FLSpielplanShape> = {}): FLSpielplanShape => ({ ...readShape(STORED), ...overrides });

/** One row by its key, so a reordering of the table cannot silently rename what a case asserts. */
const rowFor = (key: keyof FLSpielplanShape, next: FLSpielplanShape) =>
  describeShapeRows(readShape(STORED), next).find((row) => row.key === key);

describe("readShape", () => {
  /* Reach for the whole `rules` object instead and this fails: the draw's payload carries these
     three alone, and the rest of the rules shaped no fixture and have `PATCH` as their only writer. */
  it("takes the three the fixtures are a function of, and nothing else", () => {
    expect(readShape(STORED)).toStrictEqual({ number_of_gruppen: 2, teams_per_gruppe: 6, qualifiers_per_gruppe: 2 });
  });
});

describe("SHAPE_FIELDS", () => {
  /* Every one of the three, in the order the panel offers them. Drop one and the payload carries a
     number nobody chose; `FLSpielplanShape` is all three or none. */
  it("offers each of the three the payload carries", () => {
    expect(SHAPE_FIELDS.map((field) => field.key)).toStrictEqual(["number_of_gruppen", "teams_per_gruppe", "qualifiers_per_gruppe"]);
  });
});

describe("describeShapeRows", () => {
  /* State the new number alone and this fails: the redraw STORES it, so a readout that shows only
     where the season lands lets an admin confirm a rules change they were never shown. */
  it("states a moved number from and to", () => {
    expect(rowFor("number_of_gruppen", shape({ number_of_gruppen: 4 }))).toStrictEqual({
      key: "number_of_gruppen",
      label: "Gruppen",
      value: "von 2 auf 4",
      isChanged: true,
    });
  });

  /* An unmoved number reads as itself. Render every row as a move and a first-press redraw would
     claim the season's shape changed when the press leaves all three where they are. */
  it("states an unmoved number as one figure", () => {
    const row = rowFor("teams_per_gruppe", shape());

    expect(row?.value).toBe("6");
    expect(row?.isChanged).toBe(false);
  });

  /* One row per rule, always, in the table's order: a list that drops the unmoved rows would leave
     the confirmation naming a shape it has not stated in full. */
  it("returns a row for each of the three whatever moved", () => {
    const rows = describeShapeRows(readShape(STORED), shape({ qualifiers_per_gruppe: 1 }));

    expect(rows.map((row) => row.key)).toStrictEqual(SHAPE_FIELDS.map((field) => field.key));
    expect(rows.map((row) => row.isChanged)).toStrictEqual([false, false, true]);
  });

  /* The labels are the panel's own, and the fields above the readout carry the same ones. Split the
     two and the confirmation names a number by a heading no input on the page uses. */
  it("labels each row from the table the fields are built from", () => {
    expect(describeShapeRows(readShape(STORED), shape()).map((row) => row.label)).toStrictEqual(SHAPE_FIELDS.map((field) => field.label));
  });
});
