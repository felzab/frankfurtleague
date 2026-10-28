"use client";

import { useRef, useState, useTransition } from "react";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { SearchField } from "./SearchField";
import { Table } from "./Table";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";
import type { EmptyStateProps } from "./EmptyState";
import type { TableProps, TableRow } from "./Table";

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
  return (row: TableRow) => row.name.toLowerCase().includes(wanted);
};

/** The empty state a search leaves, every other field kept, where the list names its plural; else the list's own. */
const emptyForSearch = (empty: EmptyStateProps): EmptyStateProps => (empty.kind === "satz" ? empty : { ...empty, kind: "suche" });

type Shown = {
  /** The rows the page was served with, so a new render of the page starts the list afresh. */
  served: ReadonlyArray<TableRow>;
  query: string;
  rows: ReadonlyArray<TableRow>;
  cursor: string | null;
};

/**
 * The list template's table, with its search and its paging. A list read whole is searched where it is
 * held, over every row; a list past one read's cap shows „Weitere 50 laden“ only while the server reports
 * more rows, and its search runs on the server over the whole list, paged the same way. What is typed never
 * enters the address.
 */
export function ListTable({
  table,
  search,
  toolbar,
  more,
}: {
  table: TableProps;
  search?: ListSearch;
  /** The filter block and the create act, in the search field's row after it. */
  toolbar?: ReactNode;
  more?: ListMore;
}) {
  const fresh = (): Shown => ({ served: table.rows, query: "", rows: table.rows, cursor: more?.cursor ?? null });
  const [shown, setShown] = useState<Shown>(fresh);
  const [isLoading, startLoading] = useTransition();
  // Only the answer to the latest request is shown, however the answers arrive.
  const latest = useRef(0);

  let current = shown;
  if (shown.served !== table.rows) {
    current = fresh();
    setShown(current);
  }

  const request = (query: string, cursor: string | null, append: boolean) => {
    if (more === undefined) return;
    latest.current += 1;
    const asked = latest.current;
    startLoading(async () => {
      const page = await more.load({ query, cursor });
      if (asked !== latest.current) return;
      startLoading(() => setShown((state) => ({ ...state, rows: append ? [...state.rows, ...page.rows] : page.rows, cursor: page.cursor })));
    });
  };

  const onSearch = (query: string) => {
    setShown((state) => ({ ...state, query }));
    if (more === undefined) return;
    if (query.trim() === "") {
      setShown(fresh());
      latest.current += 1;
    } else {
      request(query, null, false);
    }
  };

  const isSearching = current.query.trim() !== "";
  const rows = more === undefined && isSearching ? current.rows.filter(matches(current.query)) : current.rows;

  return (
    <>
      {/* One toolbar row: the search at a reading width, the filters beside it, the create act at the row's
          end; on a phone the search keeps the width and the buttons share the next line. */}
      {(search !== undefined || toolbar !== undefined) && (
        <div className="flex flex-wrap items-center gap-3">
          {search !== undefined && (
            <div className="w-full lg:max-w-96 lg:flex-1">
              <SearchField
                label={search.label}
                value={current.query}
                onChange={onSearch}
              />
            </div>
          )}
          {toolbar}
        </div>
      )}
      <Table
        {...table}
        rows={rows}
        empty={isSearching ? emptyForSearch(table.empty) : table.empty}
      />
      {more !== undefined && current.cursor !== null && (
        <div>
          <Button
            variant="secondary"
            label={COPY.shared.weitereLaden}
            isBusy={isLoading}
            onPress={() => request(current.query, current.cursor, true)}
          />
        </div>
      )}
    </>
  );
}
