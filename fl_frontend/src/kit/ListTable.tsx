"use client";

import { createContext, use, useEffect, useRef, useState, useTransition } from "react";

import { COPY, textOf } from "@/core/copy";

import { Button } from "./Button";
import { cardSurface } from "./cardStyles";
import { EmptyState } from "./EmptyState";
import { SearchField } from "./SearchField";
import { SpielList } from "./SpielRow";
import { Table } from "./Table";
import { SchoolTiles } from "./TileGrid";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";
import type { EmptyStateProps } from "./EmptyState";
import type { SpielRowProps } from "./SpielRow";
import type { TableProps, TableRow } from "./Table";
import type { SchoolTile } from "./TileGrid";

/**
 * One page of a list past one read's cap, and where the next starts, or `null` where none follows.
 * @awaitsPage session 7's Protokoll, the one list that pages
 */
export type ListPageOfRows = { rows: ReadonlyArray<TableRow>; cursor: string | null };

/**
 * How a list past one read's cap reaches its other rows: the server reads the next 50 after a cursor, the
 * search text, where one is typed, narrowing them on the server over the whole list.
 */
export type ListMore = {
  /** Where the next page starts after the rows the page was served with; `null` where none follows. */
  cursor: string | null;
  load: (request: { query: string; cursor: string | null }) => Promise<ListPageOfRows>;
};

/**
 * The search field over a list, by its name. A list read whole is searched over its rows' names; a list past
 * one read's cap is searched on the server, which decides what it reads.
 */
export type ListSearch = { label: Copy };

/** A row's name holds what is typed, upper and lower case alike. */
const matches = (query: string) => {
  const wanted = query.trim().toLowerCase();
  return (row: TableRow) => textOf(row.name).toLowerCase().includes(wanted);
};

/**
 * The list template's matches, each with the words a visitor may search it by, searched by the text its scope
 * holds, as the Spielsuche narrows the season's matches the filters left: the cards, two a row, and a search
 * that empties the list says so.
 */
export function ListMatches({
  matches,
  empty,
}: {
  matches: ReadonlyArray<{ row: SpielRowProps & { id: string }; words: string }>;
  empty: EmptyStateProps;
}) {
  const { query } = use(ListQuery);
  const wanted = query.trim().toLowerCase();
  const shown = wanted === "" ? matches : matches.filter((match) => match.words.toLowerCase().includes(wanted));
  if (shown.length === 0)
    return (
      <div className={cardSurface({ class: "overflow-hidden" })}>
        <EmptyState {...(wanted === "" ? empty : { ...empty, kind: "search" })} />
      </div>
    );
  return (
    <SpielList
      matches={shown.map((match) => match.row)}
      layout="cards"
    />
  );
}

/**
 * The list template's school tiles, each with the words a visitor may search it by, searched by the text its
 * scope holds, as `ListMatches` searches the matches: four a row, two on a phone, and a search that empties the
 * list says so.
 */
export function ListTiles({ tiles, empty }: { tiles: ReadonlyArray<{ tile: SchoolTile; words: string }>; empty: EmptyStateProps }) {
  const { query } = use(ListQuery);
  const wanted = query.trim().toLowerCase();
  const shown = wanted === "" ? tiles : tiles.filter((tile) => tile.words.toLowerCase().includes(wanted));
  if (shown.length === 0)
    return (
      <div className={cardSurface({ class: "overflow-hidden" })}>
        <EmptyState {...(wanted === "" ? empty : { ...empty, kind: "search" })} />
      </div>
    );
  return <SchoolTiles schools={shown.map((tile) => tile.tile)} />;
}

/**
 * What is typed into a list's search field, shared by the field, which the toolbar draws at once, and the
 * table, which arrives once its rows are read.
 */
const ListQuery = createContext<{ query: string; setQuery: (query: string) => void }>({ query: "", setQuery: () => undefined });

/** A list's search text, held around its toolbar and the boundary its table waits in. */
export function ListQueryScope({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  return <ListQuery value={{ query, setQuery }}>{children}</ListQuery>;
}

/** The search field over a list, at a reading width in the toolbar row and the full width on a phone. */
export function ListSearchField({ label }: ListSearch) {
  const { query, setQuery } = use(ListQuery);
  return (
    <div className="w-full lg:max-w-96 lg:flex-1">
      <SearchField
        label={label}
        value={query}
        onChange={setQuery}
      />
    </div>
  );
}

type Shown = {
  /** The rows the page was served with, so a new render of the page starts the list afresh. */
  served: ReadonlyArray<TableRow>;
  /** The search the shown rows answer, empty for the rows the page was served with. */
  query: string;
  rows: ReadonlyArray<TableRow>;
  cursor: string | null;
};

/**
 * The list template's table, searched by the text its scope holds, and its paging. A list read whole is
 * searched where it is held, over every row; a list past one read's cap shows „Weitere 50 laden“ only while
 * the server reports more rows, and its search runs on the server over the whole list, paged the same way.
 * What is typed never enters the address.
 */
export function ListTable({ table, more }: { table: TableProps; more?: ListMore }) {
  const { query } = use(ListQuery);
  const isSearching = query.trim() !== "";
  const fresh = (): Shown => ({ served: table.rows, query: "", rows: table.rows, cursor: more?.cursor ?? null });
  const [shown, setShown] = useState<Shown>(fresh);
  const [isLoading, startLoading] = useTransition();
  // Only the answer to the latest request is shown, however the answers arrive.
  const latest = useRef(0);

  let current = shown;
  // A new render of the page, or a search emptied, shows the rows the page was served with.
  if (shown.served !== table.rows || (!isSearching && shown.query !== "")) {
    current = fresh();
    setShown(current);
  }

  // The field stands outside this table, which may arrive after something was typed, so the table follows
  // the text rather than the field's keystrokes. A list past one read's cap asks the server for it.
  useEffect(() => {
    latest.current += 1;
    if (more === undefined || query.trim() === "") return;
    const asked = latest.current;
    startLoading(async () => {
      const page = await more.load({ query, cursor: null });
      if (asked !== latest.current) return;
      startLoading(() => setShown({ served: table.rows, query, rows: page.rows, cursor: page.cursor }));
    });
  }, [query, more, table.rows]);

  const loadMore = () => {
    if (more === undefined) return;
    latest.current += 1;
    const asked = latest.current;
    startLoading(async () => {
      const page = await more.load({ query, cursor: current.cursor });
      if (asked !== latest.current) return;
      startLoading(() => setShown((state) => ({ ...state, rows: [...state.rows, ...page.rows], cursor: page.cursor })));
    });
  };

  const rows = more === undefined && isSearching ? current.rows.filter(matches(query)) : current.rows;

  return (
    <>
      <Table
        {...table}
        rows={rows}
        // A search that emptied the list says so, in the list's own plural.
        empty={isSearching ? { ...table.empty, kind: "search" } : table.empty}
      />
      {more !== undefined && current.cursor !== null && (
        <div>
          <Button
            variant="secondary"
            label={COPY.shared.loadMore}
            isBusy={isLoading}
            onPress={loadMore}
          />
        </div>
      )}
    </>
  );
}
