// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { boundBy, lineOf } from "@/core/copy";
import { COPY } from "@/core/copy/shared";

import { Table } from "./Table";

import type { TableProps } from "./Table";

/** The one row's name cell, which holds its muted line under the name. */
function nameCellOf(props: Pick<TableProps, "columns" | "rows">) {
  render(
    <Table
      label={COPY.shared.saison}
      nameLabel={COPY.shared.name}
      empty={{ kind: "none", plural: COPY.shared.startelf }}
      {...props}
    />,
  );
  const [, row] = screen.getAllByRole("row");
  if (row === undefined) throw new Error("the table drew no row");
  return within(row).getAllByRole("cell")[0]?.textContent ?? "";
}

// A phone leaves the columns out, and a row that opens nothing shows their facts on its line alone: a fact the line
// drops, or a bare date with no label saying which date it is, is lost there while every desktop pass shows the column.
describe("a stacked row's line", () => {
  it("holds each hidden column's value, after its label where the column says the label leads", () => {
    const line = nameCellOf({
      columns: [
        { key: "reason", label: COPY.shared.reason, hideOnPhone: true, onLine: "value" },
        { key: "received", label: COPY.shared.facts.received, hideOnPhone: true, onLine: "labelled" },
      ],
      rows: [
        { id: "1", name: { record: "max@example.org" }, cells: { reason: { record: "Beleidigungen" }, received: { record: "12.11.2026" } } },
      ],
    });
    expect(line).toContain(lineOf(["Beleidigungen", boundBy(COPY.shared.facts.received, "12.11.2026")]));
  });
});
