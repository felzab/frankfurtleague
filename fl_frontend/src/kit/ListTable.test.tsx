// @vitest-environment jsdom
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";

import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy/shared";
import { renderUnderNext } from "@/test-support/nextContexts";

import { Filters } from "./Filters";
import { ListMatches, ListQueryScope, ListSearchField, ListTable, ListTiles } from "./ListTable";

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

  // The harm: a name typed without its accent, „jose“ for „José“, finds nothing, and reads as if no such row stood,
  // where the same text in a combo box finds it.
  it("keeps the rows whose name holds what is typed, its accents aside", async () => {
    const rows: TableProps["rows"] = [...TABLE.rows, { id: "3", name: { record: "Halle José Martí" }, cells: {} }];
    render(
      <Searched>
        <ListTable table={{ ...TABLE, rows }} />
      </Searched>,
    );
    await userEvent.type(screen.getByRole("searchbox"), "jose");
    expect(screen.getByText("Halle José Martí")).toBeTruthy();
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
          more={{ cursor: "2", query: "", carry: { by: "kontakt" }, load }}
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
          more={{ cursor: "9", query: "", carry: { by: "system" }, load }}
        />
      </Searched>,
    );
    expect(screen.getByText("Erste Seite")).toBeTruthy();
    expect(screen.queryByText("Zweite Seite")).toBe(null);

    await userEvent.click(screen.getByRole("button", { name: COPY.shared.loadMore }));
    expect(load).toHaveBeenLastCalledWith({ by: "system", query: "", cursor: "9" });
  });

  // A page a newer build serves reads the stale line, as a form's press does: the unexpected one would call it a fault.
  it.each<[string, Answer, string]>([
    ["refused", () => Promise.resolve({ ok: false, reason: COPY.shared.failure.unexpected }), COPY.shared.failure.unexpected],
    ["lost", () => Promise.reject(new TypeError("Failed to fetch")), COPY.shared.failure.unexpected],
    [
      "asked of an action a newer build no longer serves",
      () => Promise.reject(new UnrecognizedActionError('Server Action "0" was not found on the server.')),
      COPY.shared.failure.stale,
    ],
  ])("keeps the rows drawn and says so on its status line where a page is %s", async (_, answer, line) => {
    render(
      <Searched>
        <ListTable
          table={TABLE}
          more={{ cursor: "2", query: "", load: loading(answer) }}
        />
      </Searched>,
    );

    await userEvent.click(screen.getByRole("button", { name: COPY.shared.loadMore }));

    expect(await screen.findByText(line)).toBeTruthy();
    expect(screen.getByText("Sportpark Ost")).toBeTruthy();
    expect(screen.getByRole("button", { name: COPY.shared.loadMore })).toBeTruthy();
  });

  // A next page read past the search would run on with rows the search left out.
  it("reads its next page inside the search its page read from the address", async () => {
    const load = loading(answered("Zweite Seite"));
    render(
      <Searched>
        <ListTable
          table={TABLE}
          more={{ cursor: "2", query: "Ost", load }}
        />
      </Searched>,
    );

    await userEvent.click(screen.getByRole("button", { name: COPY.shared.loadMore }));
    expect(load).toHaveBeenLastCalledWith({ query: "Ost", cursor: "2" });
  });
});

describe("a list searched in its address", () => {
  const ADDRESS = { name: "q", value: "" };
  // Next's router, inert but for the replace each case records.
  const ROUTER = {
    back: () => undefined,
    forward: () => undefined,
    refresh: () => undefined,
    push: () => undefined,
    prefetch: () => undefined,
    bfcacheId: "",
  };

  /** The field over a list searched on the server, under Next's router at `/admin/log?by=…`, its replaces recorded. */
  function drawn(initial = "") {
    const replace = vi.fn<(href: string, options?: { scroll?: boolean }) => void>();
    renderUnderNext(
      <ListQueryScope initial={initial}>
        <ListSearchField
          label={COPY.shared.saison}
          address={{ ...ADDRESS, value: initial }}
        />
      </ListQueryScope>,
      { router: { ...ROUTER, replace }, pathname: "/admin/log", search: "by=abc" },
    );
    return replace;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  // A page read per keystroke reads the whole log for every letter, and a search left out of the address is lost on
  // a reload and a shared link.
  it("replaces the address once for a burst of typing, its other parameters kept", async () => {
    // Faked so the burst's gaps never depend on how busy the machine is.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const replace = drawn();

    for (const value of ["O", "OS", "OST "]) fireEvent.change(screen.getByRole("searchbox"), { target: { value } });
    expect(replace).not.toHaveBeenCalled();

    await act(async () => vi.runOnlyPendingTimers());

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/admin/log?by=abc&q=OST", { scroll: false });
  });

  // A field opening empty over a searched list reads as no search, and its next keystroke would drop the search.
  it("opens on the search the address holds and takes it out when emptied", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const replace = drawn("Birke");
    expect(screen.getByRole<HTMLInputElement>("searchbox").value).toBe("Birke");

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    await act(async () => vi.runOnlyPendingTimers());

    expect(replace).toHaveBeenCalledWith("/admin/log?by=abc", { scroll: false });
  });

  // A filter's choice dropping the search would show the list unsearched under a field still holding the text.
  it("keeps its search when a filter's choice replaces the address", async () => {
    const replace = vi.fn<(href: string, options?: { scroll?: boolean }) => void>();
    const filter = {
      name: "type",
      label: COPY.shared.saison,
      all: COPY.shared.help,
      options: [{ id: "ban", label: COPY.shared.kader }],
      value: null,
    };
    renderUnderNext(<Filters filters={[filter]} />, { router: { ...ROUTER, replace }, pathname: "/admin/log", search: "q=Birke" });

    // The desktop's row of selects comes first; the phone's sheet holds the same ones.
    const [select] = screen.getAllByRole("button", { name: new RegExp(COPY.shared.saison) });
    if (select === undefined) throw new Error("no select drawn");
    await userEvent.click(select);
    await userEvent.click(await screen.findByRole("option", { name: COPY.shared.kader }));

    expect(replace).toHaveBeenCalledWith("/admin/log?q=Birke&type=ban", { scroll: false });
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
