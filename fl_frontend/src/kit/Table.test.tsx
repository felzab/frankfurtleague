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
          {
            id: "1",
            name: { record: LONG },
            chip: { tone: "neutral", label: COPY.verwaltung.spielort.retired },
            cells: { stadtteil: { record: "Nordend" } },
          },
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
    render(
      <Table
        {...props([
          { id: "1", name: { record: LONG }, plaque: { record: "GOE" }, href: "/saisons/2027", cells: { stadtteil: { record: "Nordend" } } },
        ])}
      />,
    );
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
    render(<Table {...props([{ id: "1", name: { record: "Goethe" }, href: "/saisons/2027", cells: { stadtteil: { record: "Nordend" } } }])} />);
    const row = screen.getByRole("link", { name: "Goethe" }).closest("tr");
    expect(row?.lastElementChild?.querySelector("svg")).not.toBe(null);
    expect(row?.children.length).toBe(screen.getAllByRole("columnheader").length + 1);
  });

  it("draws no chevron where no row leads anywhere", () => {
    render(<Table {...props([{ id: "1", name: { record: "Goethe" }, cells: { stadtteil: { record: "Nordend" } } }])} />);
    expect(screen.getByRole("table").querySelector("svg")).toBe(null);
  });
});

describe("a table's box", () => {
  it("is the card's surface standing alone, and inside a card's body no box at all", () => {
    const { container } = render(
      <>
        <Table {...props([{ id: "1", name: { record: "Goethe" }, cells: { stadtteil: { record: "Nordend" } } }])} />
        <Table
          {...props([{ id: "2", name: { record: "Bettina" }, cells: { stadtteil: { record: "Westend" } } }])}
          bare
        />
      </>,
    );
    const [alone, bare] = [...container.children].map((box) => box.className.split(" "));
    expect(alone).toEqual(expect.arrayContaining(["rounded-lg", "border", "border-border", "bg-bg-card", "overflow-x-auto"]));
    expect(bare).toStrictEqual(["overflow-x-auto"]);
  });
});

describe("a table's rank column", () => {
  // The Tabelle's places are the backend's: level clubs share one, and a club that has played no match holds
  // none and stands last. A table counting its rows would number them 1, 2, 3, 4 whatever the standing says.
  it("shows each row's own place, a shared one twice, and a dash for a row holding none", () => {
    render(
      <Table
        {...props([
          { id: "1", name: { record: "Goethe" }, place: 1, cells: { stadtteil: { record: "Nordend" } } },
          { id: "2", name: { record: "Bettina" }, place: 1, cells: { stadtteil: { record: "Westend" } } },
          { id: "3", name: { record: "Schiller" }, place: 3, cells: { stadtteil: { record: "Bornheim" } } },
          { id: "4", name: { record: "Lessing" }, place: null, cells: { stadtteil: { record: "Ostend" } } },
        ])}
        rankLabel={COPY.shared.saison}
      />,
    );
    const ranks = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.firstElementChild?.textContent);
    expect(ranks).toStrictEqual(["1", "1", "3", "–"]);
  });
});

describe("a table's head", () => {
  // A card's head is the one band a card carries; a filled column head under it reads as a second band.
  it("sets its column heads over a hairline on the card's own fill, with no fill of their own", () => {
    render(<Table {...props([{ id: "1", name: { record: "Goethe" }, href: "/saisons/2027", cells: { stadtteil: { record: "Nordend" } } }])} />);
    const head = screen.getByRole("table").querySelector("thead tr");
    expect(head?.classList).toContain("border-b");
    for (const cell of head?.children ?? []) expect(cell.className).not.toMatch(/(^|\s|:)bg-/);
  });
});

describe("a table on a phone", () => {
  // jsdom applies no stylesheet, so which width draws a column is read from its classes.
  it("draws one record column in place of the three it stands for, each count in its colour", () => {
    render(
      <Table
        {...props([
          {
            id: "1",
            name: { record: "Goethe" },
            href: "/saisons/2027",
            cells: { s: { record: "3" }, u: { record: "1" }, n: { record: "0" }, sun: { counts: [3, 1, 0] } },
          },
        ])}
        columns={[
          ...(["s", "u", "n"] as const).map((key) => ({ key, label: COPY.shared.startelf, figures: true, hideOnPhone: true })),
          { key: "sun", label: COPY.shared.saison, figures: true, phoneOnly: true },
        ]}
      />,
    );
    const [s, u, n, sun] = [...(screen.getByRole("link").closest("tr")?.children ?? [])].slice(1);
    for (const separate of [s, u, n]) expect(separate?.classList).toContain("max-lg:hidden");
    expect(sun?.classList).toContain("lg:hidden");
    expect(sun?.textContent).toBe("3-1-0");
    expect(
      [...(sun?.querySelectorAll("span") ?? [])].map(
        (count) => count.classList.contains("font-semibold") && count.className.match(/text-(\w+)/)?.[1],
      ),
    ).toStrictEqual(["success", "warn", "danger"]);
    // The heads follow their cells.
    const heads = screen.getAllByRole("columnheader").slice(1);
    expect(heads.map((head) => head.classList.contains("lg:hidden"))).toStrictEqual([false, false, false, true]);
  });

  // A prose table's sentences outrun a phone's width in columns: each row stacks, and each cell draws its column's
  // label before its words for the eye alone, the heads staying read, so a label left off, or a cell kept on one
  // line, overflows unseen, and a head hidden outright leaves the cells without their columns.
  it("stacks a prose table's row, each cell after its column's label, its heads read but not drawn, its words wrapping", () => {
    render(
      <Table
        {...props([{ id: "1", name: { record: LONG }, cells: { stadtteil: { record: LONG } } }])}
        prose
      />,
    );
    const [name, cell] = [...(screen.getByRole("row", { name: (accessible) => accessible.includes(LONG) }).children ?? [])];
    expect(name?.querySelector("[title]")?.classList).not.toContain("truncate");
    expect(cell?.classList).toContain("whitespace-normal");
    expect(cell?.classList).not.toContain("whitespace-nowrap");
    const label = cell?.firstElementChild;
    expect(label?.textContent).toBe(COPY.shared.startelf);
    expect(label?.getAttribute("aria-hidden")).toBe("true");
    expect(label?.classList).toContain("lg:hidden");
    for (const head of screen.getAllByRole("columnheader")) {
      expect(head.classList).toContain("max-lg:sr-only");
      expect(head.classList).not.toContain("max-lg:hidden");
    }
  });

  // A row drawn as a grid on a phone loses the table semantics an engine infers from its elements, so the table, its
  // rows, its heads and its cells say their roles in writing; a part left without one reads as a plain box there.
  it("writes the table's, its rows', its heads' and its cells' roles, so a row drawn as a grid keeps its semantics", () => {
    render(
      <Table
        {...props([{ id: "1", name: { record: "Goethe" }, href: "/saisons/2027", place: 1, cells: { stadtteil: { record: "Nordend" } } }])}
        rankLabel={COPY.shared.saison}
        prose
      />,
    );
    const table = screen.getByRole("table");
    expect(table.getAttribute("role")).toBe("table");
    for (const row of table.querySelectorAll("tr")) expect(row.getAttribute("role")).toBe("row");
    for (const head of table.querySelectorAll("th")) expect(head.getAttribute("role")).toBe("columnheader");
    // The rank, the name, the column and the chevron in the record's row, and the chevrons' empty head.
    const cells = table.querySelectorAll("td");
    expect(cells).toHaveLength(5);
    for (const cell of cells) expect(cell.getAttribute("role")).toBe("cell");
  });

  it("leaves the chevron out, the whole row still the link", () => {
    render(<Table {...props([{ id: "1", name: { record: "Goethe" }, href: "/saisons/2027", cells: { stadtteil: { record: "Nordend" } } }])} />);
    const row = screen.getByRole("link", { name: "Goethe" }).closest("tr");
    expect(row?.lastElementChild?.classList).toContain("max-lg:hidden");
    expect(screen.getByRole("table").querySelector("thead tr")?.lastElementChild?.classList).toContain("max-lg:hidden");
  });
});

describe("a figure short of fixtures called off", () => {
  it("carries a small red „+N“ over its corner, three quarters right of it, which a screen reader hears by name", () => {
    render(<Table {...props([{ id: "1", name: { record: "Goethe" }, cells: { stadtteil: { value: { record: "5" }, cancelled: 2 } } }])} />);
    const mark = screen.getByText(COPY.shared.season.cancelledMark(2));
    expect(mark.getAttribute("aria-hidden")).toBe("true");
    expect(mark.classList).toContain("text-danger");
    // Placed on the figure's own box, over its top-right corner, a step below the figure's size.
    expect(mark.parentElement?.firstChild?.textContent).toBe("5");
    expect(mark.parentElement?.classList).toContain("relative");
    expect([...mark.classList]).toEqual(
      expect.arrayContaining(["absolute", "end-0", "top-0", "translate-x-3/4", "-translate-y-1/2", "text-2xs"]),
    );
    expect(screen.getByText(COPY.shared.season.cancelled(2)).classList).toContain("sr-only");
  });

  it("keeps the mark's slot in every row of a column some row marks, so no figure moves", () => {
    render(
      <Table
        {...props([
          { id: "1", name: { record: "Goethe" }, cells: { stadtteil: { value: { record: "5" }, cancelled: 1 } } },
          { id: "2", name: { record: "Helmholtz" }, cells: { stadtteil: { record: "6" } } },
        ])}
      />,
    );
    const [marked, plain] = ["5", "6"].map((figure) => screen.getByText(figure).closest("td")?.firstElementChild);
    expect(plain?.className).toBe(marked?.className);
    expect(plain?.classList).toContain("px-2");
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
          { id: "1", name: { record: "Goethe" }, anchor: "goethe", cells: { stadtteil: { record: "Nordend" } } },
          { id: "2", name: { record: "Helmholtz" }, anchor: "helmholtz", cells: { stadtteil: { record: "Bockenheim" } } },
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
          { id: "1", name: { record: "Goethe" }, anchor: "goethe", cells: { stadtteil: { record: "Nordend" } } },
          { id: "2", name: { record: "Helmholtz" }, anchor: "helmholtz", cells: { stadtteil: { record: "Bockenheim" } } },
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
