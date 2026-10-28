// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { Table } from "./Table";

import type { TableProps } from "./Table";

const LANG = "Sportanlage an der Bertha-von-Suttner-Schule Mitte";

const props = (rows: TableProps["rows"]): TableProps => ({
  label: COPY.shared.saison,
  nameLabel: COPY.shared.saison,
  columns: [{ key: "ort", label: COPY.shared.startelf }],
  rows,
  empty: { kind: "satz", sentence: COPY.shared.startelf },
});

const cellOf = (text: string) => {
  const cell = screen.getByText(text).closest("td");
  if (cell === null) throw new Error(`„${text}“ stands in no cell`);
  return cell;
};

describe("a table's name cell", () => {
  it("wraps a long name rather than cutting it, never narrower than 192 px", () => {
    render(<Table {...props([{ id: "1", name: LANG, cells: { ort: "Gymnasium am Mosbacher Berg in Wiesbaden" } }])} />);
    const name = cellOf(LANG).className.split(" ");
    expect(name).toEqual(expect.arrayContaining(["min-w-48", "break-words"]));
    expect(name).not.toContain("whitespace-nowrap");
    expect(screen.getByText(LANG).className.split(" ")).not.toContain("truncate");
  });

  it("ends a linked row with the chevron, in a column of its own", () => {
    render(<Table {...props([{ id: "1", name: "Goethe", href: "/saisons/2027", cells: { ort: "Nordend" } }])} />);
    const row = screen.getByRole("link", { name: "Goethe" }).closest("tr");
    expect(row?.lastElementChild?.querySelector("svg")).not.toBe(null);
    expect(row?.children.length).toBe(screen.getAllByRole("columnheader").length + 1);
  });

  it("draws no chevron where no row leads anywhere", () => {
    render(<Table {...props([{ id: "1", name: "Goethe", cells: { ort: "Nordend" } }])} />);
    expect(screen.getByRole("table").querySelector("svg")).toBe(null);
  });

  it("keeps every other value on its line", () => {
    render(<Table {...props([{ id: "1", name: "Goethe", cells: { ort: "Nordend" } }])} />);
    expect(cellOf("Nordend").className.split(" ")).toContain("whitespace-nowrap");
  });
});
