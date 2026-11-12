// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { Table } from "./Table";

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

describe("a table's secondary column", () => {
  // The harm: a column the list marks secondary stands beside the name on a phone and pushes the row's chip onto a
  // line of its own. jsdom evaluates no container query, so the switch at 42 rem is the browser's to show: this reads
  // that the column's head and cells carry the class leaving them out below it, and that its neighbour's do not.
  it("is drawn in a wide box and left out of a narrow one, head and cells alike", () => {
    render(
      <Table
        {...props([
          { id: "1", name: { record: "verwaltung@example.org" }, cells: { district: { record: "Nordend" }, since: { record: "01.09.2026" } } },
        ])}
        columns={[
          { key: "district", label: COPY.shared.startelf },
          { key: "since", label: COPY.admin.administrators.since, hideOnPhone: true, width: "date" },
        ]}
      />,
    );

    const leftOut = (cell: Element | undefined) => cell?.className.split(" ").includes("@max-2xl:hidden");
    const [head, row] = screen.getAllByRole("row");
    expect([...(head?.children ?? [])].map(leftOut)).toStrictEqual([false, false, true]);
    expect([...(row?.children ?? [])].map(leftOut)).toStrictEqual([false, false, true]);
  });
});
