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

describe("a table's name cell", () => {
  it("sets the chip inline after the name's last word, so a wrapping name carries it on its last line", () => {
    render(
      <Table
        {...props([
          { id: "1", name: LONG, chip: { tone: "neutral", label: COPY.verwaltung.spielort.retired }, cells: { stadtteil: "Nordend" } },
        ])}
      />,
    );
    const holder = screen.getByText(COPY.verwaltung.spielort.retired).parentElement;
    // The chip stands in the name's own line box, not as a block of the cell's row beside or under it.
    expect(holder?.parentElement?.textContent).toBe(`${LONG}${COPY.verwaltung.spielort.retired}`);
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
