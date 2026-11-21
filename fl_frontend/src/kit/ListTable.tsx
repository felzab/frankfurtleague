"use client";

import { createContext, use, useEffect, useRef, useState, useTransition } from "react";
import { unstable_isUnrecognizedActionError, unstable_rethrow, usePathname, useSearchParams } from "next/navigation";

import { useFilter } from "react-aria/useFilter";

import { textOf } from "@/core/copy";
import { COPY } from "@/core/copy/shared";

import { Button } from "./Button";
import { CappedRows } from "./CappedRows";
import { Card, CardActRow } from "./Card";
import { isEdgeRefusal } from "./edgeRefusal";
import { EmptyBox, EmptyState } from "./EmptyState";
import { StatusLine } from "./FieldParts";
import { SearchField } from "./SearchField";
import { SpielList } from "./SpielRow";
import { Table } from "./Table";
import { SchoolTiles } from "./TileGrid";
import { useNavigate } from "./WholePage";

import type { ActionAnswer } from "@/core/action";
import type { Copy, Words } from "@/core/copy";
import type { Route } from "next";
import type { ReactNode } from "react";
import type { CardActRowProps } from "./Card";
import type { Clear, EmptyStateProps } from "./EmptyState";
import type { SpielRowProps } from "./SpielRow";
import type { TableProps, TableRow } from "./Table";
import type { SchoolTile } from "./TileGrid";

/** One page of a list past one read's cap, and where the next starts, or `null` where none follows. */
export type ListPageOfRows = { rows: ReadonlyArray<TableRow>; cursor: string | null };

/** What one read asks for: the search text and where the page starts, beside the values `carry` names. */
type ListRequest = { query: string; cursor: string | null; [carried: string]: string | null };

/**
 * How a list past one read's cap reaches its other rows: the server reads the next 50 after a cursor, inside the search
 * the page read from its address.
 */
export type ListMore = {
  /** Where the next page starts after the rows the page was served with; `null` where none follows. */
  cursor: string | null;
  /** The search the served rows answer, as the page read it from its address, empty for none: a later page stays inside it. */
  query: string;
  /** The page's filter values, sent beside every `load`'s request under these names, so a read stays inside them. */
  carry?: Readonly<Record<string, string>>;
  /** A server action, so it answers what the builder does (`action`). */
  load: (request: ListRequest) => Promise<ActionAnswer<ListPageOfRows>>;
};

/**
 * How long typing rests before a search is said to a screen reader, or enters the address of a list searched on the
 * server: a page read per keystroke would read the whole list for every letter. 300 ms is the pause Next's own search
 * tutorial waits.
 */
const SEARCH_PAUSE_MS = 300;

/**
 * A page of the list, or why it is not there. A read writes nothing, so a throw leaves the page as it stands, even one
 * the frontend answered, after which a form's reads it again (`answering`): that new render would take the rows drawn
 * so far away.
 */
async function pageOf({ carry, load }: ListMore, request: ListRequest): Promise<ActionAnswer<ListPageOfRows>> {
  try {
    return await load({ ...carry, ...request });
  } catch (thrown) {
    // A redirect or a not-found is how the action leads on; React hands it to Next's boundary.
    unstable_rethrow(thrown);
    if (isEdgeRefusal(thrown)) return { ok: false, reason: COPY.shared.failure.tooManyAttempts };
    // An action Next does not recognise means a newer build serves the page: the stale line, as a form words it, with
    // nothing read again, which would take the rows drawn so far away.
    if (unstable_isUnrecognizedActionError(thrown)) return { ok: false, reason: COPY.shared.failure.stale };
    return { ok: false, reason: COPY.shared.failure.unexpected };
  }
}

/**
 * The search field over a list, by its name. A list read whole is searched over its rows' names, or the `words` a row
 * states where more of it is searched; a list past one read's cap is searched on the server, which decides what it reads.
 */
export type ListSearch = {
  label: Copy;
  /** The bound the server's search publishes, past which the read refuses the text. */
  maxLength?: number;
  /**
   * The address parameter a list searched on the server reads its search from, and the text the page read there: the
   * typed text replaces it once typing pauses, as a filter's choice replaces its own, so a reload and a shared link
   * keep the search.
   */
  address?: { name: string; value: string };
};

/**
 * Whether words hold what is typed, case and accents aside, by React Aria's collator in the page's locale, as a combo
 * box filters its options: „jose“ finds „José“ and „celik“ finds „Çelik“. German search rules keep an umlaut a letter of
 * its own, so „grun“ finds no „Grün“. A list searched on the server matches as the server does.
 */
const useWordsHold = () => useFilter({ sensitivity: "base" }).contains;

/** What a search over a list read whole leaves: the items whose words hold what is typed, and every item while nothing is. */
function searched<Item>(
  items: ReadonlyArray<Item>,
  query: string,
  wordsOf: (item: Item) => string,
  hold: (words: string, typed: string) => boolean,
) {
  const wanted = query.trim();
  return {
    isSearching: wanted !== "",
    shown: wanted === "" ? items : items.filter((item) => hold(wordsOf(item), wanted)),
  };
}

const rowWords = (row: { name: Words; words?: string }) => row.words ?? textOf(row.name);

/** The sentence a list's box draws once a search finds none of its rows (`EmptyState`). */
const noneFound = (empty: EmptyStateProps | Clear) =>
  empty.kind === "clear" ? COPY.shared.empty.nothingOpen : COPY.shared.empty.search(empty.searchPlural ?? empty.plural);

/**
 * What a screen reader hears of a search over a list: how many of its rows the typed text leaves, or the sentence its
 * box draws for none, once the typing rests, never on each keystroke. It stands beside the list from the first render,
 * empty, since a region drawn together with its first words is not reliably heard, and the list's box is what a search
 * that empties it replaces. `count` is `null` where the rows shown answer no search that is done: the server's still
 * answering, or a page of them with more to come, which counts not all the search found.
 */
function SearchStatus({ count, empty }: { count: number | null; empty: EmptyStateProps | Clear }) {
  const { query } = use(ListQuery);
  const sentence = query.trim() === "" || count === null ? null : count === 0 ? noneFound(empty) : COPY.shared.searchCount(count);
  const [said, setSaid] = useState<Copy | null>(null);
  useEffect(() => {
    const pause = setTimeout(() => setSaid(sentence), SEARCH_PAUSE_MS);
    return () => clearTimeout(pause);
  }, [query, sentence]);
  return (
    <p
      role="status"
      className="sr-only">
      {said}
    </p>
  );
}

/**
 * The list template's matches, each with the words a visitor may search it by, searched by the text its scope
 * holds; a search that empties the list says so.
 */
export function ListMatches({
  matches,
  empty,
}: {
  matches: ReadonlyArray<{ row: SpielRowProps & { id: string }; words: string }>;
  empty: EmptyStateProps;
}) {
  const { query } = use(ListQuery);
  const hold = useWordsHold();
  const { isSearching, shown } = searched(matches, query, (match) => match.words, hold);
  return (
    <>
      {shown.length === 0 ? (
        <EmptyBox {...(isSearching ? { ...empty, kind: "search" } : empty)} />
      ) : (
        <SpielList
          // The search lists a whole season: more cards in view than a matchday's, none of them likelier than another.
          matches={shown.map((match) => ({ ...match.row, prefetch: false }))}
          layout="cards"
        />
      )}
      <SearchStatus
        count={shown.length}
        empty={empty}
      />
    </>
  );
}

/**
 * The list template's school tiles, each with the words a visitor may search it by, searched by the text its
 * scope holds; a search that empties the list says so.
 */
export function ListTiles({ tiles, empty }: { tiles: ReadonlyArray<{ tile: SchoolTile; words: string }>; empty: EmptyStateProps }) {
  const { query } = use(ListQuery);
  const hold = useWordsHold();
  const { isSearching, shown } = searched(tiles, query, (tile) => tile.words, hold);
  return (
    <>
      {shown.length === 0 ? (
        <EmptyBox {...(isSearching ? { ...empty, kind: "search" } : empty)} />
      ) : (
        <SchoolTiles schools={shown.map((tile) => tile.tile)} />
      )}
      <SearchStatus
        count={shown.length}
        empty={empty}
      />
    </>
  );
}

/**
 * A card of open work on the list template: its title and the count of its rows, the first five of them and the rest a
 * press away (`CappedRows`), and with none „Nichts offen.“
 */
export function ListCard({
  title,
  href,
  rows,
}: {
  title: Copy;
  /** The page listing the card's records in full, which its title links. */
  href?: Route;
  rows: ReadonlyArray<CardActRowProps & { id: string }>;
}) {
  return (
    <Card
      title={title}
      {...(href === undefined ? {} : { href })}
      count={rows.length}>
      {rows.length === 0 ? (
        <EmptyState kind="clear" />
      ) : (
        <CappedRows
          rows={rows.map(({ id, ...row }) => (
            <CardActRow
              key={id}
              {...row}
            />
          ))}
        />
      )}
    </Card>
  );
}

/** What is typed into a list's search field, shared by the field in the toolbar and the list under it. */
const ListQuery = createContext<{ query: string; setQuery: (query: string) => void }>({ query: "", setQuery: () => undefined });

/**
 * A list's search text, held around its toolbar and its list, starting from `initial`, the search a list searched on
 * the server read from its address.
 */
export function ListQueryScope({ children, initial = "" }: { children: ReactNode; initial?: string }) {
  const [query, setQuery] = useState(initial);
  const [read, setRead] = useState(initial);
  // A page read with another search, by Back or a shared link, shows it in the field; the page answering the text
  // typed leaves the field as typed, its outer spaces included.
  if (initial !== read) {
    setRead(initial);
    if (initial !== query.trim()) setQuery(initial);
  }
  return <ListQuery value={{ query, setQuery }}>{children}</ListQuery>;
}

function SearchBox({ label, maxLength, onChange }: Omit<ListSearch, "address"> & { onChange: (query: string) => void }) {
  const { query } = use(ListQuery);
  return (
    <div className="w-full lg:max-w-96 lg:flex-1">
      <SearchField
        label={label}
        value={query}
        onChange={onChange}
        maxLength={maxLength}
      />
    </div>
  );
}

/**
 * A search field whose typed text replaces the address's parameter once typing pauses, every other parameter kept, as
 * Next's search tutorial debounces its field ("Adding Search and Pagination"): the page reads its rows anew, and the
 * navigation's bar shows the wait. Only typing navigates, so a page read with another search never sends one back.
 */
function AddressSearchField({ address: { name, value }, ...field }: ListSearch & { address: { name: string; value: string } }) {
  const { setQuery } = use(ListQuery);
  const navigate = useNavigate();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pause = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(pause.current), []);
  const replace = (wanted: string) => {
    const next = new URLSearchParams(searchParams);
    if (wanted === "") next.delete(name);
    else next.set(name, wanted);
    const search = next.toString();
    navigate((search === "" ? pathname : `${pathname}?${search}`) as Route, { replace: true, scroll: false });
  };
  return (
    <SearchBox
      {...field}
      onChange={(typed) => {
        setQuery(typed);
        clearTimeout(pause.current);
        const wanted = typed.trim();
        if (wanted !== value) pause.current = setTimeout(() => replace(wanted), SEARCH_PAUSE_MS);
      }}
    />
  );
}

/** The search field over a list; one searched on the server carries its text in the address (`ListSearch.address`). */
export function ListSearchField({ address, ...field }: ListSearch) {
  const { setQuery } = use(ListQuery);
  // Apart, so a list searched where it is held reads no search parameters and its page can stay static.
  return address === undefined ? (
    <SearchBox
      {...field}
      onChange={setQuery}
    />
  ) : (
    <AddressSearchField
      {...field}
      address={address}
    />
  );
}

type Shown = {
  /** The rows the page was served with, so a new render of the page starts the list afresh. */
  served: ReadonlyArray<TableRow>;
  rows: ReadonlyArray<TableRow>;
  cursor: string | null;
  /** The line a next page's read that failed left. */
  failure: Copy | null;
};

/**
 * The list template's table, searched by the text its scope holds, and its paging. A list read whole is
 * searched where it is held, over every row; a list past one read's cap is searched by its page, which reads
 * the search from its address as it reads its filters (`ListSearch.address`), and shows „Weitere 50 laden“
 * only while the server reports more rows, each page inside the search and the filters. A search's or a
 * filter's change is a new render of the page, so it starts from the first page, and the button stands busy
 * for its own read alone. A read that fails says so on the list's status line and takes no row away.
 */
export function ListTable({ table, more }: { table: TableProps; more?: ListMore }) {
  const { query } = use(ListQuery);
  const hold = useWordsHold();
  // A list past one read's cap is searched by what its rows answer, which the text typed reaches once the page reads it.
  const isSearching = (more === undefined ? query : more.query).trim() !== "";
  const fresh = (): Shown => ({ served: table.rows, rows: table.rows, cursor: more?.cursor ?? null, failure: null });
  const [shown, setShown] = useState<Shown>(fresh);
  const [isLoading, startLoading] = useTransition();

  let current = shown;
  // A new render of the page shows the rows it was served with.
  if (shown.served !== table.rows) {
    current = fresh();
    setShown(current);
  }

  const loadMore = () => {
    if (more === undefined) return;
    const request = { query: more.query, cursor: current.cursor };
    // Emptied first, as `statusOf` has it: the last refusal is none to the read now running.
    setShown((state) => ({ ...state, failure: null }));
    startLoading(async () => {
      const answer = await pageOf(more, request);
      startLoading(() =>
        setShown((state) =>
          // A page read since started the list afresh, and this answer belongs to the rows it replaced.
          state.served !== table.rows
            ? state
            : answer.ok
              ? { ...state, rows: [...state.rows, ...answer.value.rows], cursor: answer.value.cursor }
              : { ...state, failure: answer.reason ?? COPY.shared.failure.unexpected },
        ),
      );
    });
  };

  // A list past one read's cap holds what the server's search answered.
  const rows = more === undefined ? searched(current.rows, query, rowWords, hold).shown : current.rows;
  const failure = current.failure;
  // The server's rows count the search once they answer the text typed, all of them and with no failure: a failure is
  // said on the list's own status line, and a page with more after it counts not all the search found.
  const isAnswered = more === undefined || (more.query === query.trim() && current.cursor === null && failure === null);

  return (
    <>
      <Table
        {...table}
        rows={rows}
        // A search that emptied the list says so, in the list's own plural; a list of what waits names none, and no
        // search narrows it.
        empty={isSearching && table.empty.kind !== "clear" ? { ...table.empty, kind: "search" } : table.empty}
      />
      <SearchStatus
        count={isAnswered ? rows.length : null}
        empty={table.empty}
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
            status={failure === null ? null : { tone: "danger", text: failure }}
            placement="row"
          />
        </div>
      )}
    </>
  );
}
