// @vitest-environment jsdom
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createElement as h } from "react";

import { underNext } from "@/test-support/nextContexts.ts";
import { filesUnder } from "@/test-support/treeWalk.ts";
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { assert, describe, expect, it } from "vitest";

import { AdminCrudView } from "@/shared/components/ui/AdminCrudView.tsx";

import {
  applyFacets,
  countActiveFacets,
  countFacetOptions,
  isFacetOptionReachable,
  offeredOptions,
  readFacetSelection,
  readFacetSelectionFromRoute,
} from "./facets";

import type { ComponentProps, ComponentType } from "react";
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
    expect(applyFacets(ROWS, FACETS, {})).toBe(ROWS);
    expect(applyFacets(ROWS, FACETS, { status: [] })).toBe(ROWS);
  });

  it("ORs within one facet", () => {
    expect(ids(applyFacets(ROWS, FACETS, { gruppe: ["A", "B"] }))).toStrictEqual(["1", "2", "3"]);
  });

  it("ANDs across facets", () => {
    expect(ids(applyFacets(ROWS, FACETS, { status: ["aktiv"], gruppe: ["A"] }))).toStrictEqual(["1"]);
  });

  it("drops an item that holds no value of an active facet", () => {
    // Row 4 has no group, so asking for any group excludes it. That is the honest answer rather than a
    // pass-through: it is not in a group.
    expect(ids(applyFacets(ROWS, FACETS, { gruppe: ["A", "B"] })).includes("4")).toStrictEqual(false);
  });

  it("matches an item on any of the several values it holds", () => {
    // Row 1 holds both levels, so either selection finds it. A season's `erlaubte_stufen` is the real
    // case this covers.
    expect(ids(applyFacets(ROWS, FACETS, { stufe: ["E1"] }))).toStrictEqual(["1", "4"]);
    expect(ids(applyFacets(ROWS, FACETS, { stufe: ["Q1"] }))).toStrictEqual(["1", "2"]);
  });

  it("ignores a facet the caller selected nothing in", () => {
    expect(ids(applyFacets(ROWS, FACETS, { status: ["aktiv"], gruppe: [] }))).toStrictEqual(["1", "2"]);
  });
});

describe("countFacetOptions", () => {
  it("counts every option over the whole list when nothing is selected", () => {
    const counts = countFacetOptions(ROWS, FACETS, {}, FACETS[1]!);

    expect(counts).toStrictEqual({ A: 2, B: 1 });
  });

  it("EXCLUDES the facet's own selection, so an unpicked option still reports what it would leave", () => {
    // The failure this exists to prevent: with `A` picked, counting against the current result gives
    // B: 0, and the reader concludes there are no group B rows.
    const counts = countFacetOptions(ROWS, FACETS, { gruppe: ["A"] }, FACETS[1]!);

    expect(counts).toStrictEqual({ A: 2, B: 1 });
  });

  it("applies every OTHER facet's selection", () => {
    const counts = countFacetOptions(ROWS, FACETS, { status: ["aktiv"], gruppe: ["A"] }, FACETS[1]!);

    expect(counts).toStrictEqual({ A: 1, B: 1 });
  });

  it("reports zero for an option nothing holds rather than omitting it", () => {
    const counts = countFacetOptions([], FACETS, {}, FACETS[0]!);

    expect(counts).toStrictEqual({ active: 0, retired: 0 });
  });
});

describe("readFacetSelection", () => {
  it("splits a comma-joined parameter", () => {
    const selection = readFacetSelection(FACETS, new URLSearchParams("gruppe=A,B"));

    expect(selection).toStrictEqual({ gruppe: ["A", "B"] });
  });

  it("drops a value the facet does not offer", () => {
    // The query string is user-editable, and a selection naming an option the popover has no row for
    // would leave the two halves of the control disagreeing.
    const selection = readFacetSelection(FACETS, new URLSearchParams("gruppe=A,Z"));

    expect(selection).toStrictEqual({ gruppe: ["A"] });
  });

  it("omits a facet whose every value was invalid, rather than leaving an empty array", () => {
    expect(readFacetSelection(FACETS, new URLSearchParams("gruppe=Z"))).toStrictEqual({});
  });

  it("ignores an empty parameter and every parameter that is not a facet", () => {
    expect(readFacetSelection(FACETS, new URLSearchParams("gruppe=&order=asc&saison_id=2026"))).toStrictEqual({});
  });

  it("answers with a facet's default while its parameter is absent", () => {
    expect(readFacetSelection(DEFAULTED, new URLSearchParams(""))).toStrictEqual({ status: ["aktiv"] });
    expect(readFacetSelection(DEFAULTED, new URLSearchParams("gruppe=A"))).toStrictEqual({ status: ["aktiv"], gruppe: ["A"] });
  });

  it("lets a chosen value replace a default", () => {
    expect(readFacetSelection(DEFAULTED, new URLSearchParams("status=stillgelegt"))).toStrictEqual({ status: ["stillgelegt"] });
  });

  it("lets an EMPTY parameter turn a default off, which is the only thing that can", () => {
    // `useUrlFilters` writes this form instead of deleting the parameter, so a reader who unticks a defaulted
    // facet reaches the unnarrowed list. The two halves have to agree on the form or the default reasserts.
    expect(readFacetSelection(DEFAULTED, new URLSearchParams("status="))).toStrictEqual({});
    expect(readFacetSelection(DEFAULTED, new URLSearchParams("status=&gruppe=A"))).toStrictEqual({ gruppe: ["A"] });
  });

  it("falls back to the default when a NON-EMPTY parameter matches nothing the facet offers", () => {
    // A pasted or bookmarked link reaches the wrong list carrying a value this facet has no row for,
    // and reading that as the off-switch would silently unnarrow the list
    // (`fl_frontend/src/shared/utils/facets.ts :: readFacetSelection`).
    expect(readFacetSelection(DEFAULTED, new URLSearchParams("status=aufgenommen"))).toStrictEqual({ status: ["aktiv"] });
    expect(readFacetSelection(DEFAULTED, new URLSearchParams("status=aktiv,unsinn"))).toStrictEqual({ status: ["aktiv"] });
    expect(readFacetSelection(DEFAULTED, new URLSearchParams("status=unsinn&gruppe=A"))).toStrictEqual({ status: ["aktiv"], gruppe: ["A"] });
  });

  it("reads a NON-EMPTY selection back as the same object while the query string is unchanged", () => {
    // `applyFacets` returns its input by reference only while nothing is selected, so with a facet
    // active the chain rests on this object instead: `AdminCrudView`'s memo, then the collection.
    const first = readFacetSelection(FACETS, new URLSearchParams("status=aktiv&gruppe=A"));
    const second = readFacetSelection(FACETS, new URLSearchParams("status=aktiv&gruppe=A"));

    expect(first).toBe(second);
  });

  it("reads a CHANGED query string as a new object", () => {
    const before = readFacetSelection(FACETS, new URLSearchParams("status=aktiv"));
    const after = readFacetSelection(FACETS, new URLSearchParams("status=stillgelegt"));

    expect(before).not.toBe(after);
    expect(after).toStrictEqual({ status: ["stillgelegt"] });
  });

  it("keeps one facet array's reads apart from another's", () => {
    // Two filtered surfaces render on one page, and one surface's query string must not answer the
    // other's read.
    const other: readonly Facet<Row>[] = [FACETS[0]!];

    expect(readFacetSelection(FACETS, new URLSearchParams("status=aktiv&gruppe=A"))).toStrictEqual({ status: ["aktiv"], gruppe: ["A"] });
    expect(readFacetSelection(other, new URLSearchParams("status=aktiv&gruppe=A"))).toStrictEqual({ status: ["aktiv"] });
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
    expect(readFacetSelection(LINKED, new URLSearchParams("gruppe=Z"))).toStrictEqual({ gruppe: ["Z"] });
    expect(readFacetSelection(LINKED, new URLSearchParams("gruppe=A,Z"))).toStrictEqual({ gruppe: ["A", "Z"] });
  });

  it("is offered under its own label, once, after the options the rows hold", () => {
    expect(offeredOptions(GRUPPE_LINKED, ["Z"])).toStrictEqual([
      { value: "A", label: "A" },
      { value: "B", label: "B" },
      { value: "Z", label: "Gruppe Z" },
    ]);
  });

  it("counts zero, and stays reachable while picked so it can be removed", () => {
    const counts = countFacetOptions(ROWS, LINKED, { gruppe: ["Z"] }, GRUPPE_LINKED);

    expect(counts).toStrictEqual({ A: 2, B: 1, Z: 0 });
    expect(isFacetOptionReachable(counts["Z"] ?? -1, true)).toBe(true);
  });

  it("narrows the rows to nothing rather than to everything", () => {
    expect(applyFacets(ROWS, LINKED, readFacetSelection(LINKED, new URLSearchParams("gruppe=Z")))).toStrictEqual([]);
  });

  it("is dropped where it names nothing the facet knows either", () => {
    expect(readFacetSelection(LINKED, new URLSearchParams("gruppe=6890a1b2c3d4e5f6071900ff"))).toStrictEqual({});
    expect(readFacetSelection(LINKED, new URLSearchParams("gruppe=Z,unsinn"))).toStrictEqual({ gruppe: ["Z"] });
  });

  /* Once removed nothing names it, so it leaves the panel rather than standing there as a dead row. */
  it("is offered no longer once the URL stops naming it", () => {
    expect(readFacetSelection(LINKED, new URLSearchParams(""))).toStrictEqual({});
    expect(offeredOptions(GRUPPE_LINKED, [])).toBe(GRUPPE_LINKED.options);
    expect(countFacetOptions(ROWS, LINKED, {}, GRUPPE_LINKED)).toStrictEqual({ A: 2, B: 1 });
  });

  it("leaves a facet that declares no vocabulary exactly as it was", () => {
    expect(readFacetSelection(FACETS, new URLSearchParams("gruppe=Z"))).toStrictEqual({});
    expect(offeredOptions(FACETS[1]!, ["Z"])).toBe(FACETS[1]!.options);
  });
});

describe("readFacetSelectionFromRoute", () => {
  it("reads a route's parameters exactly as the bar reads the query string", () => {
    // One reader for both halves: a page narrowing its own request differently from the control that
    // wrote the URL would serve rows the bar then filters away, with nothing saying why.
    for (const search of ["", "status=aktiv", "status=aktiv,stillgelegt", "status=", "status=unsinn&gruppe=A"]) {
      const params = Object.fromEntries(new URLSearchParams(search));

      expect(readFacetSelectionFromRoute(DEFAULTED, params)).toStrictEqual(readFacetSelection(DEFAULTED, new URLSearchParams(search)));
    }
  });

  it("reads a repeated parameter, which a route hands over as an array", () => {
    expect(readFacetSelectionFromRoute(FACETS, { status: ["aktiv", "stillgelegt"] })).toStrictEqual({ status: ["aktiv"] });
  });

  it("answers an absent parameter with the default and an empty one with nothing", () => {
    expect(readFacetSelectionFromRoute(DEFAULTED, {})).toStrictEqual({ status: ["aktiv"] });
    expect(readFacetSelectionFromRoute(DEFAULTED, { status: undefined })).toStrictEqual({ status: ["aktiv"] });
    expect(readFacetSelectionFromRoute(DEFAULTED, { status: "" })).toStrictEqual({});
  });
});

describe("isFacetOptionReachable", () => {
  it("offers an option that would leave something", () => {
    expect(isFacetOptionReachable(1, false)).toBe(true);
  });

  it("keeps a picked option reachable at zero, or it could not be deselected", () => {
    expect(isFacetOptionReachable(0, true)).toBe(true);
  });

  it("stops offering an unpicked option that would leave nothing", () => {
    // The rule a server-narrowed facet must be given real counts for: told what its own read served,
    // every status the server left out counts zero here and the control that would fetch them dies.
    expect(isFacetOptionReachable(0, false)).toBe(false);
  });
});

describe("countActiveFacets", () => {
  it("counts facets, not values", () => {
    expect(countActiveFacets({ status: ["aktiv", "stillgelegt"], gruppe: ["A"] })).toBe(2);
  });

  it("does not count a facet whose selection is empty", () => {
    expect(countActiveFacets({ status: [], gruppe: ["A"] })).toBe(1);
  });
});

/**
 * Every facet set, discovered rather than listed: each slice's `facets.ts` is found by walking `features/` and imported
 * by the path the walk yields, so a slice that adds one is checked without being named here.
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

for (const file of filesUnder(FEATURES_DIR, (name) => name === "facets.ts", 1)) {
  const slice = path.relative(FEATURES_DIR, path.dirname(file));
  const loaded: Record<string, unknown> = await import(pathToFileURL(file).href);
  for (const [name, value] of Object.entries(loaded)) {
    if (isFacetArray(value)) discovered.push([`${slice}/${name}`, value]);
  }

  // The spieler slice's team facet is assembled per call, so the discovered constant does not contain it.
  // Calling the builder with a sample club puts it under the same checks as every other facet.
  const builder = loaded["buildSpielerFacets"];
  if (typeof builder === "function") {
    const built: unknown = (builder as (teams: readonly { teamId: string; name: string; shorthand: string }[]) => unknown)([
      { teamId: "6890a1b2c3d4e5f607190001", name: "Helmholtz", shorthand: "HE" },
    ]);
    if (isFacetArray(built)) discovered.push([`${slice}/buildSpielerFacets(...)`, built]);
  }
}

describe("every facet set in the app", () => {
  // Pinned so a slice's facets quietly dropping out of the walk is a failure rather than a smaller run.
  const EXPECTED_SETS = 9;

  it("discovers every slice's facets", () => {
    expect(
      discovered.length,
      `discovered ${String(discovered.length)} facet sets, expected ${String(EXPECTED_SETS)}: ${discovered.map(([name]) => name).join(", ")}`,
    ).toBe(EXPECTED_SETS);
  });

  it("never claims a parameter another control owns, or the search query's name", () => {
    // `order`, `saison_id` and `section` belong to the read order's control, the season selector and the
    // action-required strip, which a facet claiming one fights invisibly. `q` is refused outright and
    // blanked on every access line.
    const reserved = new Set(["q", "order", "saison_id", "section"]);

    for (const [name, facets] of discovered) {
      for (const facet of facets) {
        assert.ok(!reserved.has(facet.param), `${name} facet "${facet.label}" claims the reserved parameter "${facet.param}"`);
      }
    }
  });

  it("gives each surface's facets distinct parameters", () => {
    for (const [name, facets] of discovered) {
      const params = facets.map((facet) => facet.param);

      expect(new Set(params).size, `${name} has two facets on one parameter: ${params.join(", ")}`).toBe(params.length);
    }
  });

  it("gives each facet distinct option values and a non-empty option list", () => {
    for (const [name, facets] of discovered) {
      for (const facet of facets) {
        const values = facet.options.map((option) => option.value);

        assert.ok(values.length > 0, `${name} facet "${facet.label}" offers nothing`);
        expect(new Set(values).size, `${name} facet "${facet.label}" repeats an option value`).toBe(values.length);
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
const TOLD = { stand: { active: 4, retired: 9 } };

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
      { search: query, pathname: "/bereich/admin/bewerbungen" },
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

  expect(shown.length, "the panel offers a different number of options").toBe(expected.length);

  // `String.raw`, or the `\s` is a bare `s` and the pattern matches a label nothing renders.
  const found = expected.map(([label, count]) => panel.getByRole("option", { name: new RegExp(String.raw`^${label}\s*${count}$`) }));

  expect(
    found.map((option) => shown.indexOf(option)),
    "the panel lists its options in another order",
  ).toStrictEqual(expected.map((_, at) => at));
}

/** What each option was told, per facet parameter: the numbers a view hands on as `facetCounts`. */
type Told = Record<string, Record<string, number>>;

/** The counts told for `param`, which every facet the slice declares is handed. */
const counted = (told: Told, param: string): Record<string, number> => told[param] ?? assert.fail(`no count is told for ${param}`);

const actionLogView = async () => (await import("@/features/aktionen/components/views/AdminAktionenView.tsx")).AdminAktionenView;
const bewerbungenView = async () => (await import("@/features/bewerbungen/components/views/AdminBewerbungenView.tsx")).AdminBewerbungenView;

/**
 * The view of each slice whose facets narrow the read, served no rows and told `told`, each loaded by
 * the case that renders it.
 */
const NARROWING_VIEWS: Record<string, { load: () => Promise<ComponentType<never>>; props: (told: Told) => never }> = {
  "aktionen/AKTIONEN_FACETS": {
    load: async () => (await actionLogView()) as ComponentType<never>,
    props: (told) =>
      ({
        aktionen: [],
        vollstaendig: true,
        anzahlJeCollection: counted(told, "collection"),
        anzahlJeOperation: counted(told, "operation"),
        anzahlJeHerkunft: counted(told, "herkunft"),
        dokumentId: null,
        vorgangId: null,
        richtung: "desc",
      }) satisfies ComponentProps<Awaited<ReturnType<typeof actionLogView>>> as never,
  },
  "bewerbungen/BEWERBUNGEN_FACETS": {
    load: async () => (await bewerbungenView()) as ComponentType<never>,
    props: (told) =>
      ({
        bewerbungen: [],
        anzahlJeStatus: counted(told, "status"),
        anzahlJeSaisonbezug: counted(told, "saisonbezug"),
        dublettenSchluessel: [],
        richtung: "desc",
      }) satisfies ComponentProps<Awaited<ReturnType<typeof bewerbungenView>>> as never,
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
    await userEvent.setup().click(screen.getByRole("button", { name: "Aktiv: Stand ändern" }));

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
    expect(narrowing.map(([name]) => name).sort()).toStrictEqual(Object.keys(NARROWING_VIEWS).sort());
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
        await userEvent.setup().click(screen.getByRole("button", { name: `${first.label}: ${facet.label} ändern` }));

        assertPanelOptions(facet.options.map((option, at) => [option.label, String(11 + at)]));
      });
    }
  }
});
