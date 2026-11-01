// @vitest-environment jsdom
import { Suspense, use } from "react";

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { ListQueryScope, ListSearchField, ListTable } from "./ListTable";

import type { ReactNode } from "react";
import type { TableProps } from "./Table";

const TABLE: TableProps = {
  label: COPY.shared.saison,
  nameLabel: COPY.shared.saison,
  columns: [{ key: "adresse", label: COPY.shared.startelf }],
  rows: [
    { id: "1", name: "Sportpark Ost", cells: { adresse: "Nordend" } },
    { id: "2", name: "Goethe-Halle", cells: { adresse: "Bockenheim" } },
  ],
  empty: { kind: "none", plural: COPY.shared.saison },
};

/** The list as the template places it: the search field in the toolbar, the table beside it in the same scope. */
function Searched({ children }: { children: ReactNode }) {
  return (
    <ListQueryScope>
      <ListSearchField label={COPY.shared.saison} />
      {children}
    </ListQueryScope>
  );
}

/** The table once its rows arrive, as the template's boundary reveals it. */
function Arriving({ table }: { table: Promise<TableProps> }) {
  return <ListTable table={use(table)} />;
}

describe("a list's search", () => {
  it("keeps the rows whose name holds what is typed, upper and lower case alike", async () => {
    render(
      <Searched>
        <ListTable table={TABLE} />
      </Searched>,
    );
    await userEvent.type(screen.getByRole("searchbox"), "OST");
    expect(screen.getByText("Sportpark Ost")).toBeTruthy();
    expect(screen.queryByText("Goethe-Halle")).toBe(null);
  });

  it("says a search emptied the list, in the list's own plural, rather than that nothing is there yet", async () => {
    render(
      <Searched>
        <ListTable table={TABLE} />
      </Searched>,
    );
    await userEvent.type(screen.getByRole("searchbox"), "Riedberg");
    expect(screen.getByText(COPY.shared.empty.search(COPY.shared.saison))).toBeTruthy();
    expect(screen.queryByText(COPY.shared.empty.none(COPY.shared.saison))).toBe(null);
  });

  // The field stands outside the boundary the rows wait in, so it takes text before there are rows to search.
  it("searches the rows that arrive after the text was typed", async () => {
    let arrive: (table: TableProps) => void = () => undefined;
    const table = new Promise<TableProps>((resolve) => {
      arrive = resolve;
    });
    render(
      <Searched>
        <Suspense>
          <Arriving table={table} />
        </Suspense>
      </Searched>,
    );

    await userEvent.type(screen.getByRole("searchbox"), "OST");
    await act(async () => arrive(TABLE));

    expect(screen.getByText("Sportpark Ost")).toBeTruthy();
    expect(screen.queryByText("Goethe-Halle")).toBe(null);
  });
});
