// @vitest-environment jsdom
import { Suspense, use } from "react";

import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { ListCard, ListMatches, ListQueryScope, ListSearchField, ListTable, ListTiles } from "./ListTable";

import type { ActionAnswer } from "@/core/action";
import type { ReactNode } from "react";
import type { ListPageOfRows } from "./ListTable";
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

  // The harm: a paste past the read's bound answers the shared failure line, which says nothing of the paste.
  it("stops the box at the bound the page passes", async () => {
    render(
      <ListQueryScope>
        <ListSearchField
          label={COPY.shared.saison}
          maxLength={3}
        />
      </ListQueryScope>,
    );
    await userEvent.click(screen.getByRole("searchbox"));
    await userEvent.paste("Goethe");
    expect(screen.getByRole<HTMLInputElement>("searchbox").value).toBe("Goe");
  });

  // The harm: a Sperrliste searched by the words of a Grund finds nothing, and reads as if no such ban stood.
  it("reads a row's own words in its name's place, where the row states them", async () => {
    const rows: TableProps["rows"] = [
      ...TABLE.rows,
      { id: "3", name: { record: "anna@example.org" }, words: "anna@example.org Beleidigung", cells: {} },
    ];
    render(
      <Searched>
        <ListTable table={{ ...TABLE, rows }} />
      </Searched>,
    );
    await userEvent.type(screen.getByRole("searchbox"), "beleidigung");
    expect(screen.getByText("anna@example.org")).toBeTruthy();
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

  // The harm: a team's squad, one record by its own noun, reads „Keine Kader für diese Suche.“ where nobody matched.
  it("names the rows a search missed where the list names itself by one noun", async () => {
    const empty = { kind: "none", plural: COPY.shared.kader, one: true, searchPlural: COPY.shared.spieler } as const;
    const { unmount } = render(
      <Searched>
        <ListTable table={{ ...TABLE, empty }} />
      </Searched>,
    );
    await userEvent.type(screen.getByRole("searchbox"), "Zidane");
    expect(screen.getByText(COPY.shared.empty.search(COPY.shared.spieler))).toBeTruthy();
    unmount();

    render(<ListTable table={{ ...TABLE, rows: [], empty }} />);
    expect(screen.getByText(COPY.shared.empty.noneOne(COPY.shared.kader))).toBeTruthy();
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

describe("a list past one read's cap", () => {
  const row = (id: string, name: string) => ({ id, name: { record: name }, cells: { adresse: { record: "Nordend" } } });
  type Answer = () => Promise<ActionAnswer<ListPageOfRows>>;
  const answered =
    (name: string): Answer =>
    () =>
      Promise.resolve({ ok: true, value: { rows: [row(name, name)], cursor: null } });
  // The input of a server action the builder made, its filters optional, so the kit's request has to fit one.
  const loading = (...answers: ReadonlyArray<Answer>) => {
    const load = vi.fn<(request: { query: string; cursor: string | null; by?: string }) => Promise<ActionAnswer<ListPageOfRows>>>();
    answers.forEach((answer) => load.mockImplementationOnce(answer));
    return load;
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays inside the page's filters on the next page, and a filter's change restarts from the first", async () => {
    const load = loading(answered("Zweite Seite"), answered("Dritte Seite"));
    const { rerender } = render(
      <Searched>
        <ListTable
          table={TABLE}
          more={{ cursor: "2", carry: { by: "kontakt" }, load }}
        />
      </Searched>,
    );

    await userEvent.click(screen.getByRole("button", { name: COPY.shared.loadMore }));
    expect(load).toHaveBeenLastCalledWith({ by: "kontakt", query: "", cursor: "2" });
    expect(await screen.findByText("Zweite Seite")).toBeTruthy();

    // A filter's change is a new render of the page: its first page, its cursor, its values.
    rerender(
      <Searched>
        <ListTable
          table={{ ...TABLE, rows: [row("9", "Erste Seite")] }}
          more={{ cursor: "9", carry: { by: "system" }, load }}
        />
      </Searched>,
    );
    expect(screen.getByText("Erste Seite")).toBeTruthy();
    expect(screen.queryByText("Zweite Seite")).toBe(null);

    await userEvent.click(screen.getByRole("button", { name: COPY.shared.loadMore }));
    expect(load).toHaveBeenLastCalledWith({ by: "system", query: "", cursor: "9" });
  });

  it.each<[string, Answer]>([
    ["refused", () => Promise.resolve({ ok: false, reason: COPY.shared.failure.unexpected })],
    ["lost", () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("keeps the rows drawn and says so on its status line where a page is %s", async (_, answer) => {
    render(
      <Searched>
        <ListTable
          table={TABLE}
          more={{ cursor: "2", load: loading(answer) }}
        />
      </Searched>,
    );

    await userEvent.click(screen.getByRole("button", { name: COPY.shared.loadMore }));

    expect((await screen.findByRole("status")).textContent).toBe(COPY.shared.failure.unexpected);
    expect(screen.getByText("Sportpark Ost")).toBeTruthy();
    expect(screen.getByRole("button", { name: COPY.shared.loadMore })).toBeTruthy();
  });

  // Next runs one client's actions one at a time, so a read per keystroke queues over the whole list.
  it("sends one load for a burst of typing, once the typing pauses", async () => {
    // Faked so the burst's gaps never depend on how busy the machine is.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const load = loading(answered("Sportpark Ost"));
    render(
      <Searched>
        <ListTable
          table={TABLE}
          more={{ cursor: null, load }}
        />
      </Searched>,
    );

    for (const value of ["O", "OS", "OST"]) fireEvent.change(screen.getByRole("searchbox"), { target: { value } });
    expect(load).not.toHaveBeenCalled();

    await act(async () => vi.runOnlyPendingTimers());

    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith({ query: "OST", cursor: null });
  });
});

/** A match card of the Spielsuche: its row, and the words beyond its two clubs a visitor finds it by. */
const match = (id: string, team1: string, team2: string, words: string) => ({
  row: {
    id,
    href: `/saisons/2027/spiele/${id}` as const,
    when: COPY.spielplan.when(null, null),
    team1: { name: { record: team1 }, plaque: { record: "AAA" } },
    team2: { name: { record: team2 }, plaque: { record: "BBB" } },
  },
  words: `${team1} ${team2} ${words}`,
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

describe("Teams' tiles", () => {
  const tile = (id: string, name: string, shorthand: string) => ({
    tile: { name: { record: name }, plaque: { record: shorthand }, href: `/saisons/2027/teams/${id}` as const },
    words: `${name} ${shorthand}`,
  });

  // A club is known by its Kürzel as much as by its name: the plaques on every match row show the Kürzel alone.
  it("finds a club by its name or its Kürzel, and says so in the list's words where none holds them", async () => {
    render(
      <Searched>
        <ListTiles
          tiles={[tile("1", "Elisabethenschule", "ELS"), tile("2", "Birken-Schule", "BKS")]}
          empty={{ kind: "none", plural: COPY.page.teams }}
        />
      </Searched>,
    );

    await userEvent.type(screen.getByRole("searchbox"), "bks");
    expect(screen.getByRole("link", { name: /Birken-Schule/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Elisabethenschule/ })).toBe(null);

    await userEvent.clear(screen.getByRole("searchbox"));
    await userEvent.type(screen.getByRole("searchbox"), "Elisa");
    expect(screen.getByRole("link", { name: /Elisabethenschule/ })).toBeTruthy();

    await userEvent.type(screen.getByRole("searchbox"), "x");
    expect(screen.getByText(COPY.shared.empty.search(COPY.page.teams))).toBeTruthy();
  });
});

describe("a card holding a list", () => {
  // A referee booked to a season's twenty games finds one by its clubs or its ground, as the administration's long lists
  // are searched; a search that empties the card says so, never that nothing is booked, and says it as every searched
  // list of the site does: the sentence alone in the list's box, the card's head gone as a table's head goes.
  it("finds a row by its name or its words, and says so in the list's words where none holds them", async () => {
    render(
      <Searched>
        <ListCard
          title={COPY.page.spiele}
          count={false}
          rows={[
            { id: "1", href: "/", name: { record: "Ahorn vs. Eiche" }, words: "Ahorn vs. Eiche Riedberg" },
            { id: "2", href: "/", name: { record: "Linde vs. Esche" } },
          ]}
          empty={{ kind: "none", plural: COPY.page.spiele }}
        />
      </Searched>,
    );

    await userEvent.type(screen.getByRole("searchbox"), "riedberg");
    expect(screen.getByRole("link", { name: "Ahorn vs. Eiche" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Linde vs. Esche" })).toBe(null);
    expect(screen.getByRole("heading", { name: COPY.page.spiele })).toBeTruthy();

    await userEvent.type(screen.getByRole("searchbox"), "x");
    expect(screen.getByText(COPY.shared.empty.search(COPY.page.spiele))).toBeTruthy();
    expect(screen.queryByRole("heading", { name: COPY.page.spiele })).toBe(null);
  });
});
