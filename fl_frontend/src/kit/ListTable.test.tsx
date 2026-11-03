// @vitest-environment jsdom
import { Suspense, use } from "react";

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { ListMatches, ListQueryScope, ListSearchField, ListTable } from "./ListTable";

import type { ReactNode } from "react";
import type { TableProps } from "./Table";

const TABLE: TableProps = {
  label: COPY.shared.saison,
  nameLabel: COPY.shared.saison,
  columns: [{ key: "adresse", label: COPY.shared.startelf }],
  rows: [
    { id: "1", name: { record: "Sportpark Ost" }, cells: { adresse: { record: "Nordend" } } },
    { id: "2", name: { record: "Goethe-Halle" }, cells: { adresse: { record: "Bockenheim" } } },
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

/** A match card of the Spielsuche: its row, and the words beyond its two clubs a visitor finds it by. */
const match = (id: string, home: string, away: string, words: string) => ({
  row: {
    id,
    href: `/saisons/2027/spiele/${id}` as const,
    when: COPY.spielplan.when(null, null),
    home: { name: { record: home }, plaque: { record: "AAA" } },
    away: { name: { record: away }, plaque: { record: "BBB" } },
  },
  words: `${home} ${away} ${words}`,
});

describe("the Spielsuche's matches", () => {
  // The visitor types what they saw anywhere on a match, its venue or its referee as well as its clubs.
  it("finds a match by any of its words, and says so in the list's words where none holds them", async () => {
    render(
      <Searched>
        <ListMatches
          matches={[
            match("s1", "Ahorn", "Kastanie", "Sportplatz Ahornweg Anna Ahrens"),
            match("s2", "Birke", "Linde", "Kunstrasen Eichenhain"),
          ]}
          empty={{ kind: "none", plural: COPY.page.spiele }}
        />
      </Searched>,
    );

    await userEvent.type(screen.getByRole("searchbox"), "eichenhain");
    expect(screen.getByRole("link", { name: /Birke.*Linde/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Ahorn.*Kastanie/ })).toBe(null);

    await userEvent.clear(screen.getByRole("searchbox"));
    await userEvent.type(screen.getByRole("searchbox"), "Ahrens");
    expect(screen.getByRole("link", { name: /Ahorn.*Kastanie/ })).toBeTruthy();

    await userEvent.type(screen.getByRole("searchbox"), "x");
    expect(screen.getByText(COPY.shared.empty.search(COPY.page.spiele))).toBeTruthy();
  });
});
