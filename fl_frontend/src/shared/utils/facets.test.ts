import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { applyFacets, countActiveFacets, countFacetOptions, readFacetSelection } from "./facets";

import type { Facet } from "./facets";

type Row = { id: string; status: string; gruppe: string | null; stufen: string[] };

const ROWS: Row[] = [
  { id: "1", status: "aktiv", gruppe: "A", stufen: ["E1", "Q1"] },
  { id: "2", status: "aktiv", gruppe: "B", stufen: ["Q1"] },
  { id: "3", status: "stillgelegt", gruppe: "A", stufen: [] },
  { id: "4", status: "stillgelegt", gruppe: null, stufen: ["E1"] },
];

const FACETS: readonly Facet<Row>[] = [
  {
    param: "status",
    label: "Status",
    options: [
      { value: "aktiv", label: "Aktiv" },
      { value: "stillgelegt", label: "Stillgelegt" },
    ],
    read: (row) => [row.status],
  },
  {
    param: "gruppe",
    label: "Gruppe",
    options: [
      { value: "A", label: "A" },
      { value: "B", label: "B" },
    ],
    read: (row) => (row.gruppe === null ? [] : [row.gruppe]),
  },
  {
    param: "stufe",
    label: "Stufe",
    options: [
      { value: "E1", label: "E1" },
      { value: "Q1", label: "Q1" },
    ],
    read: (row) => row.stufen,
  },
];

const ids = (rows: Row[]) => rows.map((row) => row.id);

describe("applyFacets", () => {
  it("returns the input array itself when nothing is selected", () => {
    // Identity, not just equality: `AdminCrudView` feeds this to `useFuzzySearch`, whose memo and whose
    // react-aria collection both key on the reference. A fresh array here would defeat the memo on every
    // unfiltered page in the app.
    assert.equal(applyFacets(ROWS, FACETS, {}), ROWS);
    assert.equal(applyFacets(ROWS, FACETS, { status: [] }), ROWS);
  });

  it("ORs within one facet", () => {
    assert.deepEqual(ids(applyFacets(ROWS, FACETS, { gruppe: ["A", "B"] })), ["1", "2", "3"]);
  });

  it("ANDs across facets", () => {
    assert.deepEqual(ids(applyFacets(ROWS, FACETS, { status: ["aktiv"], gruppe: ["A"] })), ["1"]);
  });

  it("drops an item that holds no value of an active facet", () => {
    // Row 4 has no group, so asking for any group excludes it. That is the honest answer rather than a
    // pass-through: it is not in a group.
    assert.deepEqual(ids(applyFacets(ROWS, FACETS, { gruppe: ["A", "B"] })).includes("4"), false);
  });

  it("matches an item on any of the several values it holds", () => {
    // Row 1 holds both levels, so either selection finds it. A season's `erlaubte_stufen` is the real
    // case this covers.
    assert.deepEqual(ids(applyFacets(ROWS, FACETS, { stufe: ["E1"] })), ["1", "4"]);
    assert.deepEqual(ids(applyFacets(ROWS, FACETS, { stufe: ["Q1"] })), ["1", "2"]);
  });

  it("ignores a facet the caller selected nothing in", () => {
    assert.deepEqual(ids(applyFacets(ROWS, FACETS, { status: ["aktiv"], gruppe: [] })), ["1", "2"]);
  });
});

describe("countFacetOptions", () => {
  it("counts every option over the whole list when nothing is selected", () => {
    const counts = countFacetOptions(ROWS, FACETS, {}, FACETS[1]!);

    assert.deepEqual(counts, { A: 2, B: 1 });
  });

  it("EXCLUDES the facet's own selection, so an unpicked option still reports what it would leave", () => {
    // The failure this exists to prevent: with `A` picked, counting against the current result gives
    // B: 0, and the reader concludes there are no group B rows.
    const counts = countFacetOptions(ROWS, FACETS, { gruppe: ["A"] }, FACETS[1]!);

    assert.deepEqual(counts, { A: 2, B: 1 });
  });

  it("applies every OTHER facet's selection", () => {
    const counts = countFacetOptions(ROWS, FACETS, { status: ["aktiv"], gruppe: ["A"] }, FACETS[1]!);

    assert.deepEqual(counts, { A: 1, B: 1 });
  });

  it("reports zero for an option nothing holds rather than omitting it", () => {
    const counts = countFacetOptions([], FACETS, {}, FACETS[0]!);

    assert.deepEqual(counts, { aktiv: 0, stillgelegt: 0 });
  });
});

describe("readFacetSelection", () => {
  it("splits a comma-joined parameter", () => {
    const selection = readFacetSelection(FACETS, new URLSearchParams("gruppe=A,B"));

    assert.deepEqual(selection, { gruppe: ["A", "B"] });
  });

  it("drops a value the facet does not offer", () => {
    // The query string is user-editable, and a selection naming an option the popover has no row for
    // would leave the two halves of the control disagreeing.
    const selection = readFacetSelection(FACETS, new URLSearchParams("gruppe=A,Z"));

    assert.deepEqual(selection, { gruppe: ["A"] });
  });

  it("omits a facet whose every value was invalid, rather than leaving an empty array", () => {
    assert.deepEqual(readFacetSelection(FACETS, new URLSearchParams("gruppe=Z")), {});
  });

  it("ignores an empty parameter and every parameter that is not a facet", () => {
    assert.deepEqual(readFacetSelection(FACETS, new URLSearchParams("gruppe=&q=helm&saison_id=2026")), {});
  });
});

describe("countActiveFacets", () => {
  it("counts facets, not values", () => {
    assert.equal(countActiveFacets({ status: ["aktiv", "stillgelegt"], gruppe: ["A"] }), 2);
  });

  it("does not count a facet whose selection is empty", () => {
    assert.equal(countActiveFacets({ status: [], gruppe: ["A"] }), 1);
  });
});

/**
 * Every facet set in the app, discovered rather than listed.
 *
 * **Imported DYNAMICALLY, by a computed path, and that is a boundary rather than a style.** This file
 * lives in `shared`, which may not import `features` (ADR-0008, enforced by ESLint) — the same constraint
 * `core/apiContract.test.ts` solves the same way. Walking the tree has the bonus that a new slice's facets
 * are covered with nothing to remember.
 */
const FEATURES_DIR = path.resolve(import.meta.dirname, "..", "..", "features");

function isFacetArray(value: unknown): value is readonly Facet<never>[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (entry: unknown) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as Facet<never>).param === "string" &&
        typeof (entry as Facet<never>).label === "string" &&
        Array.isArray((entry as Facet<never>).options) &&
        typeof (entry as Facet<never>).read === "function",
    )
  );
}

const discovered: [string, readonly Facet<never>[]][] = [];

for (const slice of readdirSync(FEATURES_DIR, { withFileTypes: true })) {
  if (!slice.isDirectory()) continue;
  const file = path.join(FEATURES_DIR, slice.name, "facets.ts");
  if (!existsSync(file)) continue;

  const loaded: Record<string, unknown> = await import(pathToFileURL(file).href);
  for (const [name, value] of Object.entries(loaded)) {
    if (isFacetArray(value)) discovered.push([`${slice.name}/${name}`, value]);
  }

  // The spieler slice's team facet is assembled per call, so the discovered constant does not contain it.
  // Calling the builder with a sample club puts it under the same checks as every other facet.
  const builder = loaded["buildSpielerFacets"];
  if (typeof builder === "function") {
    const built: unknown = (builder as (teams: readonly { teamId: string; name: string; shorthand: string }[]) => unknown)([
      { teamId: "6890a1b2c3d4e5f607190001", name: "Helmholtz", shorthand: "HE" },
    ]);
    if (isFacetArray(built)) discovered.push([`${slice.name}/buildSpielerFacets(...)`, built]);
  }
}

describe("every facet set in the app", () => {
  // Pinned so a slice's facets quietly dropping out of the walk is a failure rather than a smaller run.
  const EXPECTED_SETS = 7;

  it("discovers every slice's facets", () => {
    assert.equal(
      discovered.length,
      EXPECTED_SETS,
      `discovered ${String(discovered.length)} facet sets, expected ${String(EXPECTED_SETS)}: ${discovered.map(([name]) => name).join(", ")}`,
    );
  });

  it("never claims a parameter the search field or the season selector already owns", () => {
    // `q` is `useDebouncedUrlQuery`'s, `saison_id` is the sidemenu selector's and `section` is the
    // action-required strip's. A facet taking any of them would fight a control on the same page, and the
    // collision is invisible until somebody filters.
    const reserved = new Set(["q", "saison_id", "section"]);

    for (const [name, facets] of discovered) {
      for (const facet of facets) {
        assert.ok(!reserved.has(facet.param), `${name} facet "${facet.label}" claims the reserved parameter "${facet.param}"`);
      }
    }
  });

  it("gives each surface's facets distinct parameters", () => {
    for (const [name, facets] of discovered) {
      const params = facets.map((facet) => facet.param);

      assert.equal(new Set(params).size, params.length, `${name} has two facets on one parameter: ${params.join(", ")}`);
    }
  });

  it("gives each facet distinct option values and a non-empty option list", () => {
    for (const [name, facets] of discovered) {
      for (const facet of facets) {
        const values = facet.options.map((option) => option.value);

        assert.ok(values.length > 0, `${name} facet "${facet.label}" offers nothing`);
        assert.equal(new Set(values).size, values.length, `${name} facet "${facet.label}" repeats an option value`);
      }
    }
  });

  it("labels every facet and every option, with no empty string", () => {
    for (const [name, facets] of discovered) {
      assert.ok(
        facets.every((facet) => facet.label.trim() !== ""),
        `${name} has an unlabelled facet`,
      );
      for (const facet of facets) {
        assert.ok(
          facet.options.every((option) => option.label.trim() !== ""),
          `${name} facet "${facet.label}" has an unlabelled option`,
        );
      }
    }
  });
});
