import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { createElement as h } from "react";

import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { underNext } from "@/shared/testing/nextContexts.ts";

import {
  applyFacets,
  countActiveFacets,
  countFacetOptions,
  isFacetOptionReachable,
  offeredOptions,
  readFacetSelection,
  readFacetSelectionFromRoute,
} from "./facets";

import type { ComponentType } from "react";
import type { Facet } from "./facets";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { AdminCrudView } = await import("@/shared/components/ui/AdminCrudView.tsx");

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

/**
 * Options off the rows on hand, beside every value that exists. `Z` exists and no row holds it; its own array,
 * so the `readFacetSelection` cache keyed on the facet set cannot answer for `FACETS`.
 */
const LINKED: readonly Facet<Row>[] = [
  FACETS[0]!,
  {
    ...FACETS[1]!,
    known: [
      { value: "A", label: "A" },
      { value: "Z", label: "Gruppe Z" },
      // Two rows of one vocabulary mapped onto one value, as every anonymised referee is.
      { value: "Z", label: "Gruppe Z" },
    ],
  },
];

const GRUPPE_LINKED = LINKED[1]!;

describe("a value a link names that no row on hand holds", () => {
  /* A link from another list carries a real value nothing here holds, and dropping it shows the reader
     a page nobody asked anything of in place of an empty answer naming what they came for. */
  it("is kept in the selection where the facet knows it", () => {
    assert.deepEqual(readFacetSelection(LINKED, new URLSearchParams("gruppe=Z")), { gruppe: ["Z"] });
    assert.deepEqual(readFacetSelection(LINKED, new URLSearchParams("gruppe=A,Z")), { gruppe: ["A", "Z"] });
  });

  it("is offered under its own label, once, after the options the rows hold", () => {
    assert.deepEqual(offeredOptions(GRUPPE_LINKED, ["Z"]), [
      { value: "A", label: "A" },
      { value: "B", label: "B" },
      { value: "Z", label: "Gruppe Z" },
    ]);
  });

  it("counts zero, and stays reachable while picked so it can be removed", () => {
    const counts = countFacetOptions(ROWS, LINKED, { gruppe: ["Z"] }, GRUPPE_LINKED);

    assert.deepEqual(counts, { A: 2, B: 1, Z: 0 });
    assert.equal(isFacetOptionReachable(counts["Z"] ?? -1, true), true);
  });

  it("narrows the rows to nothing rather than to everything", () => {
    assert.deepEqual(applyFacets(ROWS, LINKED, readFacetSelection(LINKED, new URLSearchParams("gruppe=Z"))), []);
  });

  it("is dropped where it names nothing the facet knows either", () => {
    assert.deepEqual(readFacetSelection(LINKED, new URLSearchParams("gruppe=6890a1b2c3d4e5f6071900ff")), {});
    assert.deepEqual(readFacetSelection(LINKED, new URLSearchParams("gruppe=Z,unsinn")), { gruppe: ["Z"] });
  });

  /* Once removed nothing names it, so it leaves the panel rather than standing there as a dead row. */
  it("is offered no longer once the URL stops naming it", () => {
    assert.deepEqual(readFacetSelection(LINKED, new URLSearchParams("")), {});
    assert.equal(offeredOptions(GRUPPE_LINKED, []), GRUPPE_LINKED.options);
    assert.deepEqual(countFacetOptions(ROWS, LINKED, {}, GRUPPE_LINKED), { A: 2, B: 1 });
  });

  it("leaves a facet that declares no vocabulary exactly as it was", () => {
    assert.deepEqual(readFacetSelection(FACETS, new URLSearchParams("gruppe=Z")), {});
    assert.equal(offeredOptions(FACETS[1]!, ["Z"]), FACETS[1]!.options);
  });
});

describe("readFacetSelectionFromRoute", () => {
  it("reads a route's parameters exactly as the bar reads the query string", () => {
    // One reader for both halves: a page narrowing its own request differently from the control that
    // wrote the URL would serve rows the bar then filters away, with nothing saying why.
    for (const search of ["", "status=aktiv", "status=aktiv,stillgelegt", "status=", "status=unsinn&gruppe=A"]) {
      const params = Object.fromEntries(new URLSearchParams(search));

      assert.deepEqual(readFacetSelectionFromRoute(DEFAULTED, params), readFacetSelection(DEFAULTED, new URLSearchParams(search)));
    }
  });

  it("reads a repeated parameter, which a route hands over as an array", () => {
    assert.deepEqual(readFacetSelectionFromRoute(FACETS, { status: ["aktiv", "stillgelegt"] }), { status: ["aktiv"] });
  });

  it("answers an absent parameter with the default and an empty one with nothing", () => {
    assert.deepEqual(readFacetSelectionFromRoute(DEFAULTED, {}), { status: ["aktiv"] });
    assert.deepEqual(readFacetSelectionFromRoute(DEFAULTED, { status: undefined }), { status: ["aktiv"] });
    assert.deepEqual(readFacetSelectionFromRoute(DEFAULTED, { status: "" }), {});
  });
});

describe("isFacetOptionReachable", () => {
  it("offers an option that would leave something", () => {
    assert.equal(isFacetOptionReachable(1, false), true);
  });

  it("keeps a picked option reachable at zero, or it could not be deselected", () => {
    assert.equal(isFacetOptionReachable(0, true), true);
  });

  it("stops offering an unpicked option that would leave nothing", () => {
    // The rule a server-narrowed facet must be given real counts for: told what its own read served,
    // every status the server left out counts zero here and the control that would fetch them dies.
    assert.equal(isFacetOptionReachable(0, false), false);
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

/** The triage queue's shape: the page fetched only what `stand` selects, so the rows on hand cannot count its other option. */
const TOLD_FACETS: readonly Facet<Row>[] = [
  {
    param: "stand",
    label: "Stand",
    options: [
      { value: "aktiv", label: "Aktiv" },
      { value: "stillgelegt", label: "Stillgelegt" },
    ],
    narrowsTheRead: true,
    read: (row) => [row.status],
  },
];

/** Apart from both counts the served rows give, so a cell counting them instead reads as neither. */
const TOLD = { stand: { aktiv: 4, stillgelegt: 9 } };

const SERVED = ROWS.filter((row) => row.status === "aktiv");

/** The whole region a narrowing view renders, under the contexts its bar reads the URL through. */
function renderRegion(query: string): void {
  render(
    underNext(
      h(AdminCrudView<Row>, {
        items: SERVED,
        searchKeys: ["id"],
        facets: TOLD_FACETS,
        facetCounts: TOLD,
        renderTable: () => null,
      }),
      { search: query, pathname: "/admin/bewerbungen" },
    ),
  );
}

/**
 * Asserts the open panel offers exactly these options, IN ORDER, each found by role and name rather
 * than by the elements inside it: what the counts have to reach is the reader.
 */
function assertPanelOptions(expected: readonly (readonly [string, string])[]): void {
  const panel = within(screen.getByRole("dialog"));
  const shown = panel.getAllByRole("option");

  assert.equal(shown.length, expected.length, "the panel offers a different number of options");

  // `String.raw`, or the `\s` is a bare `s` and the pattern matches a label nothing renders.
  const found = expected.map(([label, count]) => panel.getByRole("option", { name: new RegExp(String.raw`^${label}\s*${count}$`) }));

  assert.deepEqual(
    found.map((option) => shown.indexOf(option)),
    expected.map((_, at) => at),
    "the panel lists its options in another order",
  );
}

/** What each option was told, per facet parameter: the numbers a view hands on as `facetCounts`. */
type Told = Record<string, Record<string, number>>;

/**
 * The view of each slice whose facets narrow the read, served no rows and told `told`. Loaded by a
 * computed path, `shared` importing nothing from `features`.
 */
const NARROWING_VIEWS: Record<string, { load: () => Promise<ComponentType<never>>; props: (told: Told) => never }> = {
  "aktionen/AKTIONEN_FACETS": {
    load: async () =>
      (
        (await import(pathToFileURL(path.join(FEATURES_DIR, "aktionen", "components", "views", "AdminAktionenView.tsx")).href)) as {
          AdminAktionenView: ComponentType<never>;
        }
      ).AdminAktionenView,
    props: (told) =>
      ({
        aktionen: [],
        vollstaendig: true,
        anzahlJeCollection: told["collection"],
        anzahlJeOperation: told["operation"],
        anzahlJeHerkunft: told["herkunft"],
        dokumentId: null,
        vorgangId: null,
        richtung: "desc",
      }) as never,
  },
  "bewerbungen/BEWERBUNGEN_FACETS": {
    load: async () =>
      (
        (await import(pathToFileURL(path.join(FEATURES_DIR, "bewerbungen", "components", "views", "AdminBewerbungenView.tsx")).href)) as {
          AdminBewerbungenView: ComponentType<never>;
        }
      ).AdminBewerbungenView,
    props: (told) =>
      ({
        bewerbungen: [],
        anzahlJeStatus: told["status"],
        anzahlJeSaisonbezug: told["saisonbezug"],
        dublettenSchluessel: [],
        richtung: "desc",
      }) as never,
  },
};

/* `facetCounts` is optional, so a hop that stops forwarding it type-checks, builds and passes every
   other case, while the panel silently returns to counting the rows one read served. */
describe("the counts a server-narrowed facet is told", () => {
  // One case per panel: the add control and a pill each hand the counts on by their own route.
  it("reach the add control's panel through every hop from the view", async () => {
    renderRegion("");
    await userEvent.setup().click(screen.getByRole("button", { name: "Filter hinzufügen" }));

    assertPanelOptions([
      ["Aktiv", "4"],
      ["Stillgelegt", "9"],
    ]);
  });

  it("reach a pill's panel through every hop from the view", async () => {
    renderRegion("stand=aktiv");
    await userEvent.setup().click(screen.getByRole("button", { name: "Stand: Aktiv ändern" }));

    assertPanelOptions([
      ["Aktiv", "4"],
      ["Stillgelegt", "9"],
    ]);
  });

  // The population is the declaration rather than a list: a slice that marks a facet `narrowsTheRead`
  // and whose view forgets the counts is exactly the pairing this exists for.
  const narrowing = discovered.filter(([, facets]) => facets.some((facet) => facet.narrowsTheRead === true));

  it("is rendered here for every slice whose facets say the server narrows", () => {
    assert.ok(narrowing.length > 0, "no slice declares a server-narrowed facet, so nothing below compares anything");
    assert.deepEqual(narrowing.map(([name]) => name).sort(), Object.keys(NARROWING_VIEWS).sort());
  });

  for (const [name, facets] of narrowing) {
    for (const facet of facets.filter((candidate) => candidate.narrowsTheRead === true)) {
      /* Served no rows, so a view dropping the counts shows every option at zero rather than what it was told. */
      it(`reaches ${name}'s „${facet.label}“ panel from the view that renders it`, async () => {
        const view = NARROWING_VIEWS[name] ?? assert.fail(`${name} narrows on the server and no view renders it here`);
        const told = Object.fromEntries(
          facets.map((each) => [each.param, Object.fromEntries(each.options.map((option, at) => [option.value, 11 + at]))]),
        );
        const first = facet.options[0] ?? assert.fail(`${name}'s „${facet.label}“ offers nothing`);

        render(underNext(h(await view.load(), view.props(told)), { search: `saison_id=2627&${facet.param}=${first.value}` }));
        await userEvent.setup().click(screen.getByRole("button", { name: `${facet.label}: ${first.label} ändern` }));

        assertPanelOptions(facet.options.map((option, at) => [option.label, String(11 + at)]));
      });
    }
  }
});
