import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Every admin CRUD list that renders its empty message inside a react-aria table. The markup was
 * byte-identical in all six, which is what let it drift out of one of them unnoticed.
 */
const TABLES = [
  "../../../features/aktionen/components/collections/AdminAktionenTable.tsx",
  "../../../features/saisons/components/collections/AdminSaisonsTable.tsx",
  "../../../features/schiedsrichter/components/collections/AdminSchiedsrichterTable.tsx",
  "../../../features/spieler/components/collections/AdminSpielerTable.tsx",
  "../../../features/spielorte/components/collections/AdminSpielorteTable.tsx",
  "../../../features/teams/components/collections/AdminTeamsTable.tsx",
];

const read = (file: string): string => readFileSync(path.resolve(import.meta.dirname, file), "utf8");

describe("the six admin CRUD tables", () => {
  /* One row tall is a height the empty `<td>` has to build itself, and a list spelling its own box
     builds a different one — which is how the tall centred panel survived in five copies. */
  it("draw the shared empty row and the shared empty card rather than spelling their own", () => {
    assert.ok(TABLES.length === 6, "the roster no longer names all six tables");

    for (const file of TABLES) {
      const source = read(file);

      assert.match(source, /renderEmptyState=\{\(\) => <AdminCrudEmptyRow /, `${file}: spells its own empty row`);
      assert.match(source, /<AdminCrudEmptyCard /, `${file}: spells its own empty card below md`);
      assert.doesNotMatch(source, /const emptyState =/, `${file}: keeps a local empty state beside the shared one`);
    }
  });

  /* Auto layout sizes a column from every row, and react-aria writes the empty state as ONE
     `<td colSpan>`: the columns collapse toward their headings the moment the rows go. */
  it("lay their columns out fixed, so the empty state cannot move one", () => {
    for (const file of TABLES) {
      assert.match(read(file), /<Table\.Content\s[^>]*className="table-fixed"/, `${file}: leaves its columns to auto layout`);
    }
  });
});
