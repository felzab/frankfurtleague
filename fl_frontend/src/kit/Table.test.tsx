// @vitest-environment jsdom
import { compiledGlobals, selectorsOf } from "@/test-support/stylesheet.ts";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { Table } from "./Table";

import type { Rule } from "postcss";
import type { TableProps } from "./Table";

const LONG = "Sportanlage an der Bertha-von-Suttner-Schule Mitte";

const props = (rows: TableProps["rows"]): TableProps => ({
  label: COPY.shared.saison,
  nameLabel: COPY.shared.saison,
  columns: [{ key: "stadtteil", label: COPY.shared.startelf }],
  rows,
  empty: { kind: "none", plural: COPY.shared.startelf },
});

/**
 * Classes that make an element the containing block of a descendant's `::after`, or clip its painting, at any
 * width: bare, or behind a variant such as `max-lg:`.
 */
const POSITIONS = /(^|\s|:)(sr-only|relative|absolute|fixed|sticky)(\s|$)/;

describe("a table's name cell", () => {
  // jsdom lays nothing out, so the cut is held by its classes: Tailwind's `truncate` on the name, `min-w-0` on
  // its flex row, and the chip a sibling of the name, `shrink-0`, so the name gives way and the chip never does.
  it("cuts a long name with „…“, whole in its title, and keeps the chip on the name's line", () => {
    render(
      <Table
        {...props([
          { id: "1", name: LONG, chip: { tone: "neutral", label: COPY.verwaltung.spielort.retired }, cells: { stadtteil: "Nordend" } },
        ])}
      />,
    );
    const name = screen.getByTitle(LONG);
    expect(name.textContent).toBe(LONG);
    expect(name.classList).toContain("truncate");
    expect(name.parentElement?.classList).toContain("min-w-0");

    const chip = screen.getByText(COPY.verwaltung.spielort.retired);
    expect(chip.parentElement).toBe(name.parentElement);
    expect([...chip.classList]).toEqual(expect.arrayContaining(["shrink-0", "whitespace-nowrap"]));
  });

  // A club's row on a phone draws its plaque alone. The name is hidden visually inside the row's link, never
  // around it: a hidden wrapper is positioned and clipped, which would shrink the link's stretched `::after`
  // to it and leave the row unable to open.
  it("on a phone draws a club's plaque alone, the row still opening the club under its full name", () => {
    render(<Table {...props([{ id: "1", name: LONG, plaque: { kuerzel: "GOE" }, href: "/saisons/2027", cells: { stadtteil: "Nordend" } }])} />);
    const link = screen.getByRole("link", { name: (accessible) => accessible.includes(LONG) });
    expect(link.getAttribute("data-kit-focus")).toBe("row");
    expect(link.textContent).toBe(`GOE${LONG}`);

    const words = screen.getByText(LONG);
    expect(words.closest("a")).toBe(link);
    expect(words.classList).toContain("max-lg:sr-only");
    expect(screen.getByText("GOE").closest("a")).toBe(link);

    // Nothing between the link and its row is positioned or clipped, so the stretched link covers the row.
    const row = link.closest("tr");
    expect(row?.classList).toContain("relative");
    for (let node = link.parentElement; node !== null && node !== row; node = node.parentElement) expect(node.className).not.toMatch(POSITIONS);
  });

  it("ends a linked row with the chevron, in a column of its own", () => {
    render(<Table {...props([{ id: "1", name: "Goethe", href: "/saisons/2027", cells: { stadtteil: "Nordend" } }])} />);
    const row = screen.getByRole("link", { name: "Goethe" }).closest("tr");
    expect(row?.lastElementChild?.querySelector("svg")).not.toBe(null);
    expect(row?.children.length).toBe(screen.getAllByRole("columnheader").length + 1);
  });

  it("draws no chevron where no row leads anywhere", () => {
    render(<Table {...props([{ id: "1", name: "Goethe", cells: { stadtteil: "Nordend" } }])} />);
    expect(screen.getByRole("table").querySelector("svg")).toBe(null);
  });
});

describe("a table's box", () => {
  it("is the card's surface standing alone, and inside a card's body no box at all", () => {
    const { container } = render(
      <>
        <Table {...props([{ id: "1", name: "Goethe", cells: { stadtteil: "Nordend" } }])} />
        <Table
          {...props([{ id: "2", name: "Bettina", cells: { stadtteil: "Westend" } }])}
          bare
        />
      </>,
    );
    const [alone, bare] = [...container.children].map((box) => box.className.split(" "));
    expect(alone).toEqual(expect.arrayContaining(["rounded-lg", "border", "border-border", "bg-bg-card", "overflow-x-auto"]));
    expect(bare).toStrictEqual(["overflow-x-auto"]);
  });
});

describe("a table's head", () => {
  // A card's head is the one band a card carries; a filled column head under it reads as a second band.
  it("sets its column heads over a hairline on the card's own fill, with no fill of their own", () => {
    render(<Table {...props([{ id: "1", name: "Goethe", href: "/saisons/2027", cells: { stadtteil: "Nordend" } }])} />);
    const head = screen.getByRole("table").querySelector("thead tr");
    expect(head?.classList).toContain("border-b");
    for (const cell of head?.children ?? []) expect(cell.className).not.toMatch(/(^|\s|:)bg-/);
  });
});

describe("a figure short of fixtures called off", () => {
  it("carries a red „+N“ centred on its corner, which a screen reader hears by name", () => {
    render(<Table {...props([{ id: "1", name: "Goethe", cells: { stadtteil: { value: "5", cancelled: 2 } } }])} />);
    const mark = screen.getByText(COPY.shared.season.cancelledMark(2));
    expect(mark.getAttribute("aria-hidden")).toBe("true");
    expect(mark.classList).toContain("text-danger");
    // Placed on the figure's own box, centred on its top-right corner.
    expect(mark.parentElement?.firstChild?.textContent).toBe("5");
    expect(mark.parentElement?.classList).toContain("relative");
    expect([...mark.classList]).toEqual(expect.arrayContaining(["absolute", "end-0", "top-0", "translate-x-1/2", "-translate-y-1/2"]));
    expect(screen.getByText(COPY.shared.season.cancelled(2)).classList).toContain("sr-only");
  });

  it("keeps the mark's slot in every row of a column some row marks, so no figure moves", () => {
    render(
      <Table
        {...props([
          { id: "1", name: "Goethe", cells: { stadtteil: { value: "5", cancelled: 1 } } },
          { id: "2", name: "Helmholtz", cells: { stadtteil: "6" } },
        ])}
      />,
    );
    const [marked, plain] = ["5", "6"].map((figure) => screen.getByText(figure).closest("td")?.firstElementChild);
    expect(plain?.className).toBe(marked?.className);
    expect(plain?.classList).toContain("pe-2");
  });
});

describe("a table row a link points to", () => {
  afterEach(() => {
    window.location.hash = "";
    window.history.replaceState(null, "", "/");
  });

  // A club's line in a match head opens the Tabelle at its row by the row's fragment: the browser makes the row
  // the document's target, and the stylesheet marks the target.
  it("is the document's target while the address names it, and the target is marked", async () => {
    render(
      <Table
        {...props([
          { id: "1", name: "Goethe", anchor: "goethe", cells: { stadtteil: "Nordend" } },
          { id: "2", name: "Helmholtz", anchor: "helmholtz", cells: { stadtteil: "Bockenheim" } },
        ])}
      />,
    );
    window.location.hash = "#helmholtz";

    const target = document.querySelector(":target");
    expect(target).toBe(screen.getByText("Helmholtz").closest("tr"));

    const marked: string[] = [];
    (await compiledGlobals()).walkDecls("animation-name", (decl) => {
      if (decl.parent?.type !== "rule") return;
      const selectors = selectorsOf(decl.parent as Rule).map((selector) => selector.replace(/\\(.)/g, "$1"));
      const classes = [...(target?.classList ?? [])];
      if (selectors.some((selector) => selector.includes(":target") && classes.some((name) => selector.includes(`.${name}`))))
        marked.push(decl.value);
    });
    expect(marked).toStrictEqual(["kit-target"]);
  });

  // Next's link pushes the history entry, which in a browser never sets `:target` (jsdom matches `:target` to
  // the address whatever set it, so it cannot show that), and the table marks the row itself.
  it("is marked after a client navigation to its fragment, which the browser never makes the target", async () => {
    window.history.pushState(null, "", "/saisons/2027/tabelle#helmholtz");
    render(
      <Table
        {...props([
          { id: "1", name: "Goethe", anchor: "goethe", cells: { stadtteil: "Nordend" } },
          { id: "2", name: "Helmholtz", anchor: "helmholtz", cells: { stadtteil: "Bockenheim" } },
        ])}
      />,
    );

    const row = screen.getByText("Helmholtz").closest("tr");
    // The named row alone, and no other.
    expect([...document.querySelectorAll("[data-kit-target]")]).toStrictEqual([row]);

    const marked: string[] = [];
    (await compiledGlobals()).walkDecls("animation-name", (decl) => {
      if (decl.parent?.type !== "rule") return;
      const selectors = selectorsOf(decl.parent as Rule).map((selector) => selector.replace(/\\(.)/g, "$1"));
      if (selectors.some((selector) => selector.includes(".kit-target[data-kit-target]"))) marked.push(decl.value);
    });
    expect(marked).toStrictEqual(["kit-target"]);
  });
});
