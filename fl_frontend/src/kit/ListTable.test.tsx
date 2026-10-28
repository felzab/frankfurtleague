// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { ListTable } from "./ListTable";

import type { TableProps } from "./Table";

const TABLE: TableProps = {
  label: COPY.shared.saison,
  nameLabel: COPY.shared.saison,
  columns: [{ key: "adresse", label: COPY.shared.startelf }],
  rows: [
    { id: "1", name: "Sportpark Ost", cells: { adresse: "Nordend" } },
    { id: "2", name: "Goethe-Halle", cells: { adresse: "Bockenheim" } },
  ],
  empty: { kind: "noch", plural: COPY.shared.saison },
};

describe("a list's search", () => {
  it("keeps the rows whose name holds what is typed, upper and lower case alike", async () => {
    render(
      <ListTable
        table={TABLE}
        search={{ label: COPY.shared.saison }}
      />,
    );
    await userEvent.type(screen.getByRole("searchbox"), "OST");
    expect(screen.getByText("Sportpark Ost")).toBeTruthy();
    expect(screen.queryByText("Goethe-Halle")).toBe(null);
  });
});
