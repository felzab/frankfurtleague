// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { Table, TablePlaceholder } from "./Table";

import type { TableProps } from "./Table";

const props = (rows: TableProps["rows"]): TableProps => ({
  label: COPY.shared.saison,
  nameLabel: COPY.shared.saison,
  columns: [{ key: "district", label: COPY.shared.startelf }],
  rows,
  empty: { kind: "none", plural: COPY.shared.startelf },
});

describe("a table's rank column", () => {
  // The Tabelle's places are the backend's: level clubs share one, and a club that has played no match holds
  // none and stands last. A table counting its rows would number them 1, 2, 3, 4 whatever the standing says.
  it("shows each row's own place, a shared one twice, and a dash for a row holding none", () => {
    render(
      <Table
        {...props([
          { id: "1", name: { record: "Goethe" }, place: 1, cells: { district: { record: "Nordend" } } },
          { id: "2", name: { record: "Bettina" }, place: 1, cells: { district: { record: "Westend" } } },
          { id: "3", name: { record: "Schiller" }, place: 3, cells: { district: { record: "Bornheim" } } },
          { id: "4", name: { record: "Lessing" }, place: null, cells: { district: { record: "Ostend" } } },
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

const CUT: TableProps["columns"][number] = { key: "grund", label: COPY.shared.saison, hideOnPhone: true, width: "line", cut: true };

describe("a row's acts", () => {
  const COLUMNS: TableProps["columns"] = [CUT, { key: "bis", label: COPY.shared.startelf, narrow: true, width: "date" }];
  const PLAIN: TableProps["rows"][number] = { id: "1", name: { record: "anna@example.org" }, cells: { bis: { record: "2030" } } };
  const ACTING: TableProps["rows"][number] = {
    id: "2",
    name: { record: "ben@example.org" },
    cells: {},
    acts: <button type="button">{COPY.shared.verb.remove}</button>,
  };

  it("gives the whole table one act column, which a row with no acts leaves empty and a phone leaves out", () => {
    render(
      <Table
        {...props([PLAIN, ACTING])}
        columns={COLUMNS}
      />,
    );
    const [, plain, acting] = screen.getAllByRole("row");
    expect(plain?.lastElementChild?.textContent).toBe("");
    expect(plain?.lastElementChild?.className).toContain("max-lg:hidden");
    expect(acting?.lastElementChild?.textContent).toBe(COPY.shared.verb.remove);
    expect(acting?.lastElementChild?.className).not.toContain("max-lg:hidden");
  });

  // The harm: rows and head share these tracks on a phone. A column too many leaves the name a share of the row, one
  // too few sends a cell onto a line of its own, and no check reads a phone's layout.
  it("gives a phone's grid the name's track and one for each column the phone keeps", () => {
    render(
      <Table
        {...props([PLAIN, ACTING])}
        columns={COLUMNS}
      />,
    );
    expect(screen.getByRole("table").style.gridTemplateColumns).toBe("minmax(0, 1fr) repeat(1, auto)");
  });

  // The harm: `repeat(0, …)` voids the declaration, so a browser draws no track at all, and the row still reads.
  it("gives a phone's grid the name's track alone where the phone keeps no column", () => {
    render(
      <Table
        {...props([ACTING])}
        columns={[]}
      />,
    );
    expect(screen.getByRole("table").style.gridTemplateColumns).toBe("minmax(0, 1fr)");
  });

  it("leaves a table none of whose rows acts as a table: no act column and no grid", () => {
    render(
      <Table
        {...props([PLAIN])}
        columns={COLUMNS}
      />,
    );
    expect(screen.getByRole("table").getAttribute("style")).toBe(null);
    expect(screen.getByRole("table").className).not.toContain("max-lg:grid");
    expect(screen.getAllByRole("row").at(-1)?.children).toHaveLength(3);
  });
});

describe("a row's phone lines in an act table", () => {
  const ROW: TableProps["rows"][number] = {
    id: "1",
    name: { record: "anna.katharina.mustermann@example.org" },
    chip: { tone: "warn", label: COPY.admin.expired },
    cells: { bis: { record: "2030" } },
    acts: <button type="button">{COPY.shared.verb.remove}</button>,
  };
  const COLUMNS: TableProps["columns"] = [{ key: "bis", label: COPY.shared.startelf }];

  // The harm: a chip and a column beside it cut an address to a third, its `title` out of a touch's reach, and the name
  // is what tells the rows apart. No check reads a phone's layout.
  it("gives the name a line of its own across the row, wrapping, with the chips under it", () => {
    render(
      <Table
        {...props([ROW])}
        columns={COLUMNS}
      />,
    );
    const name = screen.getByText("anna.katharina.mustermann@example.org");
    expect(name.className).toContain("max-lg:col-span-full");
    expect(name.className).toContain("max-lg:whitespace-normal");
    expect(screen.getByText(COPY.admin.expired).parentElement?.className).toContain("max-lg:col-start-1");
    expect(name.closest("td")?.className).toContain("max-lg:contents");
    expect(name.parentElement?.className).toContain("max-lg:contents");
    expect(screen.getByText("2030").closest("td")?.className).toContain("max-lg:order-1");
  });

  // The harm: with its name out of the first track a row without chips would drop its column into that track.
  it("keeps a row's column in its own track where the row has no chip", () => {
    render(
      <Table
        {...props([{ ...ROW, chip: undefined } as TableProps["rows"][number]])}
        columns={COLUMNS}
      />,
    );
    const name = screen.getByText("anna.katharina.mustermann@example.org");
    expect(name.nextElementSibling?.className).toContain("max-lg:col-start-1");
  });

  it("leaves a table no row of which acts as it stood", () => {
    const { acts: _acts, ...plain } = ROW;
    render(
      <Table
        {...props([plain])}
        columns={COLUMNS}
      />,
    );
    const name = screen.getByText("anna.katharina.mustermann@example.org");
    expect(name.className).not.toContain("max-lg:col-span-full");
    expect(name.closest("td")?.className).not.toContain("max-lg:contents");
  });
});

describe("a row's name cell", () => {
  it("sets the line under the name, and the delivery's chip after the state's", () => {
    render(
      <Table
        {...props([
          {
            id: "1",
            name: { record: "anna@example.org" },
            chip: { tone: "warn", label: COPY.admin.expired },
            delivery: { tone: "danger", label: COPY.admin.delivery.undeliverable },
            line: { record: "Neuer Administrator" },
            cells: {},
          },
        ])}
      />,
    );
    const nameLine = screen.getByText(COPY.admin.expired).parentElement?.parentElement;
    expect(nameLine?.textContent).toContain(COPY.admin.delivery.undeliverable);
    expect(nameLine?.nextElementSibling?.textContent).toBe("Neuer Administrator");
  });

  // The harm: on a phone two chips and a date column leave an address 26 px at 400 px wide and overrun the date at 360,
  // and no check reads a phone's layout.
  it("stands the delivery's chip on a line of its own on a phone", () => {
    render(
      <Table
        {...props([
          {
            id: "1",
            name: { record: "anna@example.org" },
            chip: { tone: "warn", label: COPY.admin.expired },
            delivery: { tone: "danger", label: COPY.admin.delivery.undeliverable },
            cells: {},
          },
        ])}
      />,
    );
    expect(screen.getByText(COPY.admin.delivery.undeliverable).parentElement?.className).toContain("max-lg:row-start-2");
  });
});

describe("a cut column", () => {
  // The harm: a Grund of 500 characters in a plain cell widens its column past the row, and only a long one shows it.
  it("holds its words out of the column's width", () => {
    render(
      <Table
        {...props([{ id: "1", name: { record: "anna@example.org" }, cells: { grund: { record: "Beleidigung" } } }])}
        columns={[CUT]}
      />,
    );
    const words = screen.getByText("Beleidigung");
    expect(words.className).toContain("truncate");
    expect(words.closest("td")?.className).toContain("max-w-0");
  });
});

describe("a table's wait", () => {
  const HEAD = { nameLabel: COPY.shared.name, columns: [{ key: "bis", label: COPY.shared.startelf }] };

  // The harm: a wait drawn otherwise than the rows it stands for shifts every row as they land.
  it("draws a row's acts as buttons, and no chevron, from the table's head", () => {
    const { container } = render(
      <TablePlaceholder
        head={{ ...HEAD, acts: [COPY.shared.verb.remove] }}
        rows={2}
      />,
    );
    expect(screen.getAllByText(COPY.shared.verb.remove)).toHaveLength(2);
    expect(container.querySelector("svg")).toBe(null);
  });

  it("ends in no chevron where the head says the rows open nothing, and stacks where it says they stack", () => {
    const { container } = render(
      <TablePlaceholder
        head={{ ...HEAD, linked: false, stack: true }}
        rows={1}
      />,
    );
    expect(container.querySelector("svg")).toBe(null);
    expect(container.querySelector("tbody tr")?.className).toContain("max-lg:grid-cols-1");
  });

  it("ends in the chevron for a head that says nothing of its rows", () => {
    const { container } = render(
      <TablePlaceholder
        head={HEAD}
        rows={1}
      />,
    );
    expect(container.querySelector("svg")).not.toBe(null);
  });
});
