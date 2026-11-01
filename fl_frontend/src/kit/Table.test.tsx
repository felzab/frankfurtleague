// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { Table } from "./Table";

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
