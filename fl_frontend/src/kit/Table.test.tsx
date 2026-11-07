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
});
