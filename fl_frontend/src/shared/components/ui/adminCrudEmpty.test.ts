import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * The Aktionen column, by the most controls ONE row can hold: 40 each with `gap-2` between, inside a
 * `px-6` cell, at the spacing step above that sum. Below three the „Aktionen“ heading is wider and
 * decides it instead.
 */
const ACTIONS_WIDTH: Record<number, string> = { 1: "w-32", 2: "w-36", 3: "w-48", 4: "w-60", 5: "w-72" };

/**
 * Every admin CRUD list that renders its empty message inside a react-aria table; the markup was
 * byte-identical in all six, which let it drift out of one unnoticed. `alternates` are the controls
 * a row can never show together.
 */
const TABLES = [
  { file: "../../../features/aktionen/components/collections/AdminAktionenTable.tsx", controls: 1, alternates: 0 },
  { file: "../../../features/saisons/components/collections/AdminSaisonsTable.tsx", controls: 3, alternates: 0 },
  { file: "../../../features/schiedsrichter/components/collections/AdminSchiedsrichterTable.tsx", controls: 4, alternates: 1 },
  { file: "../../../features/spieler/components/collections/AdminSpielerTable.tsx", controls: 4, alternates: 1 },
  { file: "../../../features/spielorte/components/collections/AdminSpielorteTable.tsx", controls: 5, alternates: 1 },
  { file: "../../../features/teams/components/collections/AdminTeamsTable.tsx", controls: 5, alternates: 1 },
];

const read = (file: string): string => readFileSync(path.resolve(import.meta.dirname, file), "utf8");

describe("the six admin CRUD tables", () => {
  /* One row tall is a height the empty `<td>` has to build itself, and a list spelling its own box
     builds a different one — which is how the tall centred panel survived in five copies. */
  it("draw the shared empty row and the shared empty card rather than spelling their own", () => {
    assert.ok(TABLES.length === 6, "the roster no longer names all six tables");

    for (const { file } of TABLES) {
      const source = read(file);

      assert.match(source, /renderEmptyState=\{\(\) => <AdminCrudEmptyRow /, `${file}: spells its own empty row`);
      assert.match(source, /<AdminCrudEmptyCard /, `${file}: spells its own empty card below md`);
      assert.doesNotMatch(source, /const emptyState =/, `${file}: keeps a local empty state beside the shared one`);
    }
  });

  /* React-aria writes the empty state as ONE `<td colSpan>`, which sizes no column: under auto
     layout the columns collapse the moment the rows go. A declared width is then an allocation, so
     the minimum is what keeps it off the free-text columns. */
  it("lay their columns out fixed, over a minimum the declared ones cannot exhaust", () => {
    for (const { file } of TABLES) {
      // The Prettier plugin owns the order inside the attribute, so this reads tokens rather than a string.
      const layout = (/<Table\.Content\s[^>]*className="([^"]*)"/.exec(read(file))?.[1] ?? "").split(" ");

      assert.ok(layout.includes("table-fixed"), `${file}: leaves its columns to auto layout`);
      assert.ok(
        layout.some((token) => token.startsWith("min-w-")),
        `${file}: names no floor for its free-text columns`,
      );
    }
  });

  /* A control added to a row that already fills its column wraps the widest row onto a second line,
     and nothing else reports it: fixed layout will not widen the column to take the new control. */
  it("size the Aktionen column from the controls a row can hold", () => {
    for (const { file, controls, alternates } of TABLES) {
      const source = read(file);

      const declared = source.match(/<RowAction(?:Link|Copy|Restore|Delete)\b/g)?.length ?? 0;
      assert.equal(declared, controls + alternates, `${file}: holds a control the roster here does not count`);

      // The heading is the only `text-right` column, which is what makes this the Aktionen one.
      const width = /border-border (w-\d+) border-b px-6 py-4 text-right/.exec(source)?.[1];
      assert.equal(width, ACTIONS_WIDTH[controls], `${file}: its Aktionen column is not the width ${String(controls)} controls need`);
    }
  });
});
