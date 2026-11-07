"use client";

import { createContext, use, useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";

import { COPY, textOf } from "@/core/copy";

import { Button } from "./Button";
import { cardSurface } from "./cardStyles";
import { isEdgeRefusal } from "./edgeRefusal";
import { EmptyState } from "./EmptyState";
import { StatusLine } from "./FieldParts";
import { SearchField } from "./SearchField";
import { SpielList } from "./SpielRow";
import { Table } from "./Table";
import { SchoolTiles } from "./TileGrid";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";
import type { EmptyStateProps } from "./EmptyState";
import type { SpielRowProps } from "./SpielRow";
import type { TableProps, TableRow } from "./Table";
import type { SchoolTile } from "./TileGrid";

/** One page of a list past one read's cap, and where the next starts, or `null` where none follows. */
export type ListPageOfRows = { rows: ReadonlyArray<TableRow>; cursor: string | null };

/** What one read asks for: the search text and where the page starts, beside the values `carry` names. */
type ListRequest = { query: string; cursor: string | null; [carried: string]: string | null };

/**
 * How a list past one read's cap reaches its other rows: the server reads the next 50 after a cursor, the
 * search text, where one is typed, narrowing them on the server over the whole list.
 */
export type ListMore = {
  /** Where the next page starts after the rows the page was served with; `null` where none follows. */
  cursor: string | null;
  /** The page's filter values, sent beside every `load`'s request under these names, so a read stays inside them. */
  carry?: Readonly<Record<string, string>>;
  /** A server action, so it answers what the builder does (`fl_frontend/src/core/action.ts :: action`). */
  load: (request: ListRequest) => Promise<ActionAnswer<ListPageOfRows>>;
};

/**
 * How long typing rests before the server search goes out. Next sends one client's actions one at a time, so a word sent
 * per keystroke queues its reads over the whole list; 300 ms is the pause Next's own search tutorial waits.
 */
const SEARCH_PAUSE_MS = 300;

/**
 * A page of the list, or why it is not there. A read writes nothing, so a throw leaves the page as it stands, where a
 * form's reads it again (`fl_frontend/src/kit/useFormAction.ts :: answering`): that new render would take the rows drawn
 * so far away.
 */
async function pageOf({ carry, load }: ListMore, request: ListRequest): Promise<ActionAnswer<ListPageOfRows>> {
  try {
    return await load({ ...carry, ...request });
  } catch (thrown) {
    // A redirect or a not-found is how the action leads on; React hands it to Next's boundary.
    unstable_rethrow(thrown);
    return { ok: false, reason: isEdgeRefusal(thrown) ? COPY.shared.failure.tooManyAttempts : COPY.shared.failure.unexpected };
  }
}

/**
 * The search field over a list, by its name. A list read whole is searched over its rows' names, or the `words` a row
 * states where more of it is searched; a list past one read's cap is searched on the server, which decides what it reads.
 */
export type ListSearch = { label: Copy };

/** A row's words, its name where it states none, hold what is typed, upper and lower case alike. */
const matches = (query: string) => {
  const wanted = query.trim().toLowerCase();
  return (row: TableRow) => (row.words ?? textOf(row.name)).toLowerCase().includes(wanted);
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
      // The search lists a whole season: more cards in view than a matchday's, none of them likelier than another.
      matches={shown.map((match) => ({ ...match.row, prefetch: false }))}
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
  /** The line a read that failed left, and the text in the field when it did: another text is another question. */
  failure: { query: string; line: Copy } | null;
};

/**
 * The list template's table, searched by the text its scope holds, and its paging. A list read whole is
 * searched where it is held, over every row; a list past one read's cap shows „Weitere 50 laden“ only while
 * the server reports more rows, and its search runs on the server over the whole list once typing pauses,
 * paged the same way, each inside the page's filters. A filter's change is a new render of the page, so it
 * starts from the first page. A read that fails says so on the list's status line and takes no row away.
 * What is typed never enters the address.
 */
export function ListTable({ table, more }: { table: TableProps; more?: ListMore }) {
  const { query } = use(ListQuery);
  const isSearching = query.trim() !== "";
  const fresh = (): Shown => ({ served: table.rows, query: "", rows: table.rows, cursor: more?.cursor ?? null, failure: null });
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

  const read = (request: ListRequest, take: (state: Shown, page: ListPageOfRows) => Shown) => {
    if (more === undefined) return;
    latest.current += 1;
    const asked = latest.current;
    // Emptied first, as `statusOf` has it: the live region announces the same refusal twice only after an empty line.
    setShown((state) => ({ ...state, failure: null }));
    startLoading(async () => {
      const answer = await pageOf(more, request);
      if (asked !== latest.current) return;
      startLoading(() =>
        setShown((state) =>
          answer.ok ? take(state, answer.value) : { ...state, failure: { query, line: answer.reason ?? COPY.shared.failure.unexpected } },
        ),
      );
    });
  };

  const search = useEffectEvent(() => {
    read({ query, cursor: null }, (state, page) => ({ ...state, query, rows: page.rows, cursor: page.cursor }));
  });

  // The field stands outside this table, which may arrive after something was typed, so the table follows
  // the text rather than the field's keystrokes. A list past one read's cap asks the server for it, once.
  useEffect(() => {
    latest.current += 1;
    if (more === undefined || query.trim() === "") return;
    const pause = setTimeout(() => search(), SEARCH_PAUSE_MS);
    return () => clearTimeout(pause);
  }, [query, more, table.rows]);

  const loadMore = () => {
    // The search the rows answer: text still in its pause has not replaced them yet.
    read({ query: current.query, cursor: current.cursor }, (state, page) => ({
      ...state,
      rows: [...state.rows, ...page.rows],
      cursor: page.cursor,
    }));
  };

  const rows = more === undefined && isSearching ? current.rows.filter(matches(query)) : current.rows;
  const failure = current.failure?.query === query ? current.failure.line : null;

  return (
    <>
      <Table
        {...table}
        rows={rows}
        // A search that emptied the list says so, in the list's own plural.
        empty={isSearching ? { ...table.empty, kind: "search" } : table.empty}
      />
      {more !== undefined && (
        <div className="flex items-center gap-3">
          {current.cursor !== null && (
            <Button
              variant="secondary"
              label={COPY.shared.loadMore}
              isBusy={isLoading}
              onPress={loadMore}
            />
          )}
          {/* Standing with no button too: a search over the last page fails as any read does. */}
          <StatusLine
            status={failure === null ? null : { tone: "error", text: failure }}
            placement="row"
          />
        </div>
      )}
    </>
  );
}
