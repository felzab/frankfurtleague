import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { underNext } from "@/shared/testing/nextContexts.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";

import type { Facet } from "@/shared/utils/facets.ts";
import type { Leserichtung } from "@/shared/utils/leserichtung.ts";

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { FilterLeiste } = await import("./FilterLeiste.tsx");

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

const bar = (query: string, leserichtung?: Leserichtung): string =>
  renderTree(underNext(h(FilterLeiste<Row>, { facets: FACETS, items: ROWS, leserichtung: leserichtung }), { search: query }));

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
  /* The whole safety property of the control: every surface drawing this bar but the capped lists
     passes no direction, and every one of them must draw exactly what it drew before. */
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
  /* No room for a `<Label>`, so the control is named by the words it shows, the painted value first (WCAG 2.5.3)
     and then the tooltip's; react-aria lands the tooltip's `aria-describedby` on this same trigger. */
  it("is named by the value it paints and the tooltip's words, and paints only the value", () => {
    const html = bar("", "desc");

    assert.match(html, /aria-label="Neueste zuerst: Ladereihenfolge ändern"/, "the picker is not named by the words it shows");
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
    assert.match(bar("order=asc", "asc"), /aria-label="Älteste zuerst: Ladereihenfolge ändern"/, "the name still says the end no longer shown");
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

    assert.ok(at('aria-label="Filter hinzufügen"') < at("Ladereihenfolge ändern"), "the read order is drawn before the add control");
    assert.ok(at("Aktiv: Status ändern") < at("Ladereihenfolge ändern"), "the read order is drawn before the pills");
  });

  /* The order removes no row, so it is in no active count: a reader who reverses the read and then
     clears every filter keeps the end they chose. */
  it("raises the reset control on two filtering facets and never on the order alone", () => {
    assert.doesNotMatch(bar("", "desc"), /Alle Filter zurücksetzen/);
    assert.doesNotMatch(bar("status=aktiv", "desc"), /Alle Filter zurücksetzen/);
    assert.match(bar("status=aktiv&gruppe=A", "desc"), /Alle Filter zurücksetzen/);
  });
});

describe("a pill's name", () => {
  /* Speech input says what a pill paints, its first value and the badge's count, so the name opens with them
     (WCAG 2.5.3); that value alone tells a screen reader neither what it filters nor what the badge counts. */
  it("starts with the words it paints, then names the dimension and every value picked", () => {
    assert.match(bar("status=aktiv"), /aria-label="Aktiv: Status ändern"/, "a one-value pill is not named by its value first");
    assert.match(
      bar("status=aktiv,stillgelegt"),
      /aria-label="Aktiv \+1: Status ändern \(Aktiv, Stillgelegt\)"/,
      "a pill whose badge counts more is not named by its painted words first, or drops a value",
    );
  });
});

describe("where removing a filter leaves the focus", () => {
  /** The bar at the live address, rendered again after a press as Next renders it once the address moves. */
  function liveBar(query: string): { user: ReturnType<typeof userEvent.setup>; renderAgain: () => void } {
    window.history.replaceState(null, "", `/liste?${query}`);
    const tree = () => underNext(h(FilterLeiste<Row>, { facets: FACETS, items: ROWS }), { search: window.location.search, pathname: "/liste" });
    const { rerender } = render(tree());

    return { user: userEvent.setup(), renderAgain: () => rerender(tree()) };
  }

  /* The clear control goes with its pill, from under the caret that pressed it; the pill after it
     takes the focus, so a reader clearing filters one by one stays in the row. */
  it("hands it to the next pill's clear control once a pill is removed", async () => {
    const { user, renderAgain } = liveBar("status=aktiv&gruppe=A");

    await user.click(screen.getByRole("button", { name: "Filter Status entfernen" }));
    renderAgain();
    // A boolean rather than the node: a failing report inspects a jsdom node's whole window.
    const weiter = document.activeElement === screen.getByRole("button", { name: "Filter Gruppe entfernen" });

    assert.ok(weiter, "the removed pill left the focus on the page");
  });

  it("moves no focus when the bar first renders", () => {
    liveBar("status=aktiv&gruppe=A");

    assert.ok(document.activeElement === document.body, "the bar took the focus on load, with no pill removed");
  });

  /* A pick in the add panel moves the address as a removal does, and draws a pill where none was. */
  it("leaves the focus where it stands once a pill is added", () => {
    const { renderAgain } = liveBar("status=aktiv");
    const pill = screen.getByRole("button", { name: "Aktiv: Status ändern" });
    pill.focus();

    window.history.replaceState(null, "", "/liste?status=aktiv&gruppe=A");
    renderAgain();

    assert.ok(document.activeElement === pill, "an added pill pulled the focus away from where it stood");
  });

  it("hands it to the add control once the last pill or every pill is removed", async () => {
    const { user, renderAgain } = liveBar("status=aktiv&gruppe=A");

    await user.click(screen.getByRole("button", { name: "Alle Filter zurücksetzen" }));
    renderAgain();
    const nachAllen = document.activeElement === screen.getByRole("button", { name: "Filter hinzufügen" });

    window.history.replaceState(null, "", "/liste?status=aktiv");
    renderAgain();
    await user.click(screen.getByRole("button", { name: "Filter Status entfernen" }));
    renderAgain();
    const nachLetztem = document.activeElement === screen.getByRole("button", { name: "Filter hinzufügen" });

    assert.ok(nachAllen, "the reset unmounted under the caret and the focus fell to the page");
    assert.ok(nachLetztem, "the last pill's removal left the focus on the page");
  });
});
