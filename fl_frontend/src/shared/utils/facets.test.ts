import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

/** Its own array, so the `readFacetSelection` cache below keyed on the facet set cannot answer for `FACETS`. */
const DEFAULTED: readonly Facet<Row>[] = [{ ...FACETS[0]!, defaultValues: ["aktiv"] }, FACETS[1]!];

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

  it("answers with a facet's default while its parameter is absent", () => {
    assert.deepEqual(readFacetSelection(DEFAULTED, new URLSearchParams("")), { status: ["aktiv"] });
    assert.deepEqual(readFacetSelection(DEFAULTED, new URLSearchParams("gruppe=A")), { status: ["aktiv"], gruppe: ["A"] });
  });

  it("lets a chosen value replace a default", () => {
    assert.deepEqual(readFacetSelection(DEFAULTED, new URLSearchParams("status=stillgelegt")), { status: ["stillgelegt"] });
  });

  it("lets an EMPTY parameter turn a default off, which is the only thing that can", () => {
    // `useUrlFilters` writes this form instead of deleting the parameter, so a reader who unticks a defaulted
    // facet reaches the unnarrowed list. The two halves have to agree on the form or the default reasserts.
    assert.deepEqual(readFacetSelection(DEFAULTED, new URLSearchParams("status=")), {});
    assert.deepEqual(readFacetSelection(DEFAULTED, new URLSearchParams("status=&gruppe=A")), { gruppe: ["A"] });
  });

  it("falls back to the default when a NON-EMPTY parameter matches nothing the facet offers", () => {
    // A pasted or bookmarked link reaches the wrong list carrying a value this facet has no row for,
    // and reading that as the off-switch would silently unnarrow the list
    // (`fl_frontend/src/shared/utils/facets.ts :: readFacetSelection`).
    assert.deepEqual(readFacetSelection(DEFAULTED, new URLSearchParams("status=aufgenommen")), { status: ["aktiv"] });
    assert.deepEqual(readFacetSelection(DEFAULTED, new URLSearchParams("status=aktiv,unsinn")), { status: ["aktiv"] });
    assert.deepEqual(readFacetSelection(DEFAULTED, new URLSearchParams("status=unsinn&gruppe=A")), { status: ["aktiv"], gruppe: ["A"] });
  });

  it("reads a NON-EMPTY selection back as the same object while the query string is unchanged", () => {
    // `applyFacets` returns its input by reference only while nothing is selected, so with a facet
    // active the chain rests on this object instead: `AdminCrudView`'s memo, then the collection.
    const first = readFacetSelection(FACETS, new URLSearchParams("status=aktiv&gruppe=A"));
    const second = readFacetSelection(FACETS, new URLSearchParams("status=aktiv&gruppe=A"));

    assert.equal(first, second);
  });

  it("reads a CHANGED query string as a new object", () => {
    const before = readFacetSelection(FACETS, new URLSearchParams("status=aktiv"));
    const after = readFacetSelection(FACETS, new URLSearchParams("status=stillgelegt"));

    assert.notEqual(before, after);
    assert.deepEqual(after, { status: ["stillgelegt"] });
  });

  it("keeps one facet array's reads apart from another's", () => {
    // Two filtered surfaces render on one page, and one surface's query string must not answer the
    // other's read.
    const other: readonly Facet<Row>[] = [FACETS[0]!];

    assert.deepEqual(readFacetSelection(FACETS, new URLSearchParams("status=aktiv&gruppe=A")), { status: ["aktiv"], gruppe: ["A"] });
    assert.deepEqual(readFacetSelection(other, new URLSearchParams("status=aktiv&gruppe=A")), { status: ["aktiv"] });
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
 * Every facet set, discovered rather than listed. **Imported dynamically by a computed path, which is a boundary rather
 * than a style**: this file lives in `shared`, which may not import `features`.
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
  const EXPECTED_SETS = 9;

  it("discovers every slice's facets", () => {
    assert.equal(
      discovered.length,
      EXPECTED_SETS,
      `discovered ${String(discovered.length)} facet sets, expected ${String(EXPECTED_SETS)}: ${discovered.map(([name]) => name).join(", ")}`,
    );
  });

  it("never claims a parameter the search field or the season selector already owns", () => {
    // `q`, `saison_id` and `section` belong to the search field, the season selector and the
    // action-required strip. A facet claiming one fights a control on the same page, invisibly until
    // somebody filters.
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

  it("defaults a facet only to values it offers", () => {
    // An unoffered default narrows the surface to nothing and draws a pill with no label on it, and nothing at
    // runtime reports why — `readFacetSelection` passes a default through without the offered-set filter.
    for (const [name, facets] of discovered) {
      for (const facet of facets) {
        const offered = new Set(facet.options.map((option) => option.value));

        for (const value of facet.defaultValues ?? []) {
          assert.ok(offered.has(value), `${name} facet "${facet.label}" defaults to "${value}", which it does not offer`);
        }
      }
    }
  });
});

const APP_DIR = path.resolve(import.meta.dirname, "..", "..", "app");
// Separators normalised before it is tested, so the pattern does not have to know the platform's.
const VIEWS_GLOB = /components\/views\/Admin\w+View\.tsx$/;
const asPosix = (file: string): string => file.split(path.sep).join("/");

/** Every `.ts`/`.tsx` under a directory, recursively. */
function sourcesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourcesUnder(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const isClientModule = (source: string): boolean => /^\s*(?:\/\/.*\n|\/\*[\s\S]*?\*\/\n|\s)*["']use client["']/.test(source);

describe("who may hold a facet", () => {
  /* A facet carries a `read` FUNCTION, which a Server Component may not pass to a Client one
     (`.claude/CLAUDE.md` §6). Neither `tsc` nor `next build` sees it; the page throws at render with
     a digest alone. */
  it("keeps every facets module out of the server half of the app", () => {
    const leaks = sourcesUnder(APP_DIR)
      .filter((file) => !isClientModule(readFileSync(file, "utf8")))
      .filter((file) => /from "[^"]*facets"/.test(readFileSync(file, "utf8")))
      .map((file) => asPosix(path.relative(APP_DIR, file)));

    assert.deepEqual(
      leaks,
      [],
      `these server modules import a facets module, whose \`read\` cannot cross into a client:\n  ${leaks.join("\n  ")}`,
    );
  });

  /* The same defect arriving as a prop instead of an import: a view that TAKES its facets is handed
     them by whoever renders it, and the admin pages are Server Components. Built inside the view
     from plain data, nothing but data crosses. */
  it("builds every admin view's facets inside the view rather than taking them", () => {
    const views = sourcesUnder(FEATURES_DIR).filter((file) => VIEWS_GLOB.test(asPosix(file)));
    assert.ok(views.length > 0, "no admin views were found, so this case compares nothing");

    const nehmen = views
      .filter((file) => /\bfacets\s*[,:}]/.test(readFileSync(file, "utf8").split(")")[0] ?? ""))
      .map((file) => asPosix(path.relative(FEATURES_DIR, file)));

    assert.deepEqual(nehmen, [], `these views take their facets as a prop instead of building them:\n  ${nehmen.join("\n  ")}`);
  });
});
