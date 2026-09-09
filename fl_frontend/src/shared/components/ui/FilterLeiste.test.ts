import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* No public export carries either context — `useUrlFilters` reads the first and `useFacetSelection`
   the second — and the bar renders under both. A Next release that moves either module fails this
   file at import rather than quietly. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";

import type { Facet } from "@/shared/utils/facets.ts";
import type { Leserichtung } from "@/shared/utils/leserichtung.ts";

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { FilterLeiste } = await import("./FilterLeiste.tsx");

const SRC = path.resolve(import.meta.dirname, "..", "..", "..");

type Row = { id: string; status: string; gruppe: string };

const ROWS: Row[] = [
  { id: "1", status: "aktiv", gruppe: "A" },
  { id: "2", status: "stillgelegt", gruppe: "B" },
];

/** Module scope, as every real call site's must be. Two facets, so the reset control has a threshold to cross. */
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
      { value: "A", label: "Gruppe A" },
      { value: "B", label: "Gruppe B" },
    ],
    read: (row) => [row.gruppe],
  },
];

/** What `useRouter` hands the control. `bfcacheId` is a value rather than a call. */
const ROUTER = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "",
};

const bar = (query: string, leserichtung?: Leserichtung): string =>
  renderTree(
    h(
      AppRouterContext.Provider,
      { value: ROUTER },
      h(
        SearchParamsContext.Provider,
        { value: new URLSearchParams(query) },
        h(FilterLeiste<Row>, { facets: FACETS, items: ROWS, leserichtung: leserichtung }),
      ),
    ),
  );

/** The collection react-aria mirrors into a hidden native `<select>`, in document order. */
function mirroredOptions(html: string): { value: string; label: string; isSelected: boolean }[] {
  const select = /<select[^>]*>(.*?)<\/select>/s.exec(html)?.[1] ?? "";

  return [...select.matchAll(/<option ([^>]*)>(.*?)<\/option>/gs)]
    .map((found) => ({ attrs: found[1] ?? "", label: (found[2] ?? "").trim() }))
    .filter((option) => /value="[^"]+"/.test(option.attrs))
    .map((option) => ({
      value: /value="([^"]*)"/.exec(option.attrs)?.[1] ?? "",
      label: option.label,
      isSelected: /\bselected\b/.test(option.attrs),
    }));
}

describe("the bar without a read order", () => {
  /* The whole safety property of the control: eight of the ten surfaces that draw this bar pass no
     direction, and every one of them must draw exactly what it drew before. */
  it("draws no read-order control at all", () => {
    for (const query of ["", "status=aktiv", "status=aktiv&gruppe=A"]) {
      const html = bar(query);

      assert.doesNotMatch(html, /Ladereihenfolge/, "the bar names the read order on a surface that passes none");
      assert.doesNotMatch(html, /<select/, "the bar mounts a picker on a surface that passes no read order");
      assert.doesNotMatch(html, /Neueste zuerst|Älteste zuerst/, "the bar paints a read order on a surface that passes none");
    }
  });

  it("still draws the add control and the reset, so the case above is not comparing an empty bar", () => {
    assert.match(bar(""), /aria-label="Filter hinzufügen"/);
    assert.match(bar("status=aktiv&gruppe=A"), /Alle Filter zurücksetzen/);
  });
});

describe("the bar with a read order", () => {
  /* The field's name rides on the control, the bar having no room for a `<Label>`, and the tooltip
     carries the verb — react-aria lands the tooltip's `aria-describedby` on this same trigger. */
  it("carries the field's name and paints only the value", () => {
    const html = bar("", "desc");

    assert.match(html, /aria-label="Ladereihenfolge"/, "the picker carries no name for the field it changes");
    assert.match(html, / aria-describedby="/, "the tooltip's hint reaches no assistive technology");
    assert.match(html, />Neueste zuerst</, "the trigger paints no read order");
  });

  /* Two rows and no more, in the order the bar offers them: the default end first, so the list opens
     on the state the page is already in rather than on the alternative. */
  it("offers both ends in the mirrored collection, the served one selected", () => {
    assert.deepEqual(mirroredOptions(bar("", "desc")), [
      { value: "desc", label: "Neueste zuerst", isSelected: true },
      { value: "asc", label: "Älteste zuerst", isSelected: false },
    ]);
  });

  it("flips which end is selected without reordering the two", () => {
    assert.deepEqual(mirroredOptions(bar("order=asc", "asc")), [
      { value: "desc", label: "Neueste zuerst", isSelected: false },
      { value: "asc", label: "Älteste zuerst", isSelected: true },
    ]);
    assert.match(bar("order=asc", "asc"), />Älteste zuerst</);
  });

  /* Filter left, read order right, and a pill appends between them: the control sits last so adding a
     filter moves neither fixed control, and neither can be scrolled out of reach. */
  it("sits after the add control, and after a pill once one is drawn", () => {
    const html = bar("status=aktiv", "desc");
    const at = (teil: string) => {
      const stelle = html.indexOf(teil);
      assert.notEqual(stelle, -1, `the bar no longer renders: ${teil}`);

      return stelle;
    };

    assert.ok(at('aria-label="Filter hinzufügen"') < at('aria-label="Ladereihenfolge"'), "the read order is drawn before the add control");
    assert.ok(at("Status: Aktiv ändern") < at('aria-label="Ladereihenfolge"'), "the read order is drawn before the pills");
  });

  /* The order removes no row, so it is in no active count: a reader who reverses the read and then
     clears every filter keeps the end they chose. */
  it("raises the reset control on two filtering facets and never on the order alone", () => {
    assert.doesNotMatch(bar("", "desc"), /Alle Filter zurücksetzen/);
    assert.doesNotMatch(bar("status=aktiv", "desc"), /Alle Filter zurücksetzen/);
    assert.match(bar("status=aktiv&gruppe=A", "desc"), /Alle Filter zurücksetzen/);
  });
});

/** Every module drawing the bar, by both routes into it, `AdminCrudView` itself being the second route's forwarder. */
const BAR_SURFACES = filesUnder(SRC, (name) => name.endsWith(".tsx") && !isTestFile(name), 200)
  .filter((file) => !file.endsWith(`${path.sep}AdminCrudView.tsx`))
  .filter((file) => /<(?:AdminCrudView|FilterLeiste)\b/.test(readFileSync(file, "utf8")))
  .map((file) => file.split(SRC)[1]?.split(path.sep).join("/") ?? "");

describe("which surfaces offer a read order", () => {
  /* The population is every surface that draws the bar and the property is which of them pass a
     direction, so a surface acquiring one cannot drop out of the walk instead of failing it. */
  it("finds the surfaces that draw the bar at all", () => {
    assert.ok(BAR_SURFACES.length > 2, `only ${String(BAR_SURFACES.length)} surfaces draw the bar, so this case compares nothing`);
  });

  /* Named rather than counted: a third list acquiring a read-order control is a decision, and it is
     taken here before it reaches a component every admin list renders. */
  it("passes a direction from the two capped lists and from nowhere else", () => {
    const passing = BAR_SURFACES.filter((file) => /leserichtung=/.test(readFileSync(path.join(SRC, file), "utf8"))).sort();

    assert.deepEqual(passing, [
      "/features/aktionen/components/views/AdminAktionenView.tsx",
      "/features/bewerbungen/components/views/AdminBewerbungenView.tsx",
    ]);
  });
});
