import { Card } from "./Card";
import { CardGrid } from "./CardGrid";
import { Dialog } from "./Dialog";
import { actLabel } from "./dialogAct";
import { EmptyBox } from "./EmptyState";
import { Filters } from "./Filters";
import { Link } from "./Link";
import { ListCard, ListMatches, ListQueryScope, ListSearchField, ListTable, ListTiles } from "./ListTable";
import { RailPage } from "./RailFrame";
import { SeatRows } from "./SeatRows";
import { Tabs } from "./Tabs";
import { TeamHead } from "./TeamHead";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import type { CardActRowProps } from "./Card";
import type { DialogAct } from "./dialogAct";
import type { EmptyStateProps } from "./EmptyState";
import type { Filter } from "./Filters";
import type { ListMore, ListSearch } from "./ListTable";
import type { RailPageHead } from "./RailFrame";
import type { SeatRow } from "./SeatRows";
import type { SpielRowProps } from "./SpielRow";
import type { TableBody, TableHead } from "./Table";
import type { SchoolTile } from "./TileGrid";

/** The matchday tabs, each with its matches, and the tab the server chose by `chosenTab`. */
type SpieltagTabs = {
  label: Copy;
  selectedKey: string;
  tabs: ReadonlyArray<{ id: string; label: Copy; panel: ReactNode }>;
};

/**
 * A table's rows, and how a list past one read's cap reaches the rest; its head is the list's, stated before the read.
 * Or the table a client page draws, `ListTable` with its head, where its rows open a dialog of the page (`onOpen`).
 */
type TableContent = { table: TableBody; more?: ListMore } | { drawn: ReactElement };

export type SpieltageContent = {
  /** The matchday tabs; `null` while the season has no matchday yet. */
  tabs: SpieltagTabs | null;
  /** Why there is no matchday to show, standing in the tabs' place. */
  empty: EmptyStateProps;
};

/**
 * Open work, one card per kind in its order of reading, such as the administrator's Übersicht: each card's title and
 * count over its records, the first five of a longer card's rows and the rest a press away (`CappedRows`), every card
 * drawn every day, one with nothing waiting saying so.
 */
type CardsContent = {
  /** The team whose own Übersicht this is, heading the cards: its plaque and its full name (`TeamHead`). */
  team?: ComponentProps<typeof TeamHead>;
  cards: ReadonlyArray<{
    id: string;
    title: Copy;
    /**
     * The page listing the card's records in full, where they have no page each, such as a team's registrations: the
     * card's title links it once, and its rows open nothing.
     */
    href?: Route;
    rows: ReadonlyArray<CardActRowProps & { id: string }>;
  }>;
  /**
   * Who holds the seats of the record the work belongs to, such as a team's on its own Übersicht: the last card, which
   * only shows them, so a seat carries no act.
   */
  seats?: { title: Copy; rows: ReadonlyArray<Omit<SeatRow, "acts">> };
};

/** Matches the filters left, each with the words the search narrows them by. */
type SpieleContent = { matches: ReadonlyArray<{ row: SpielRowProps & { id: string }; words: string }>; empty: EmptyStateProps };

/** Clubs the filters left as school tiles, each with the words the search narrows them by. */
type TilesContent = { tiles: ReadonlyArray<{ tile: SchoolTile; words: string }>; empty: EmptyStateProps };

type ListContent =
  | {
      kind: "table";
      /** The search field's name, where the list holds about 20 rows or more. */ search?: ListSearch;
      head: TableHead;
      content: Promise<TableContent>;
    }
  | {
      kind: "drawn";
      /**
       * What the page draws from its read, its own empty state included where it reads nothing to show, such as the
       * Tabelle's group cards, the K.-o.-Baum or Administratoren's folded cards: a page drawing no client block ships
       * none of its code.
       */
      content: Promise<ReactElement>;
    }
  | {
      kind: "spieltage";
      content: Promise<SpieltageContent>;
    }
  | {
      kind: "cards";
      content: Promise<CardsContent>;
    }
  | {
      kind: "spiele";
      search: ListSearch;
      content: Promise<SpieleContent>;
    }
  | {
      kind: "tiles";
      search: ListSearch;
      content: Promise<TilesContent>;
    };

/**
 * A page's cards: side by side in the grid, or a lone one at the content's width, beside which the grid's second column
 * would stand empty.
 */
function Cards({ boxes, children }: { boxes: number; children: ReactNode }) {
  return boxes === 1 ? children : <CardGrid>{children}</CardGrid>;
}

/** The tab row, and under it the chosen matchday's matches alone: the other matchdays' matches never reach the page. */
function Spieltage({ label, selectedKey, tabs }: SpieltagTabs) {
  return (
    <Tabs
      label={label}
      selectedKey={selectedKey}
      tabs={tabs.map((tab) => ({ id: tab.id, label: tab.label }))}>
      {tabs.find((tab) => tab.id === selectedKey)?.panel}
    </Tabs>
  );
}

async function FiltersOnceRead({ filters }: { filters: Promise<ReadonlyArray<Filter>> }) {
  return <Filters filters={await filters} />;
}

/**
 * A record created where its list shows: the dialog's act, and why it cannot run on the list as it stands, which the
 * page read, the button saying why. The lock is the trigger's, never the dialog's own send, which `DialogAct`'s
 * `locked` would be. Omitted from each of `DialogAct`'s two shapes, so a touched act still demands its dry run.
 */
export type ListCreate = DialogAct extends infer Act ? (Act extends DialogAct ? Omit<Act, "locked"> & { locked?: Copy } : never) : never;

/**
 * An act at the toolbar row's end, its button opening the dialog over the list: the create act, or as `side` the second
 * act before it, a secondary button.
 */
function ToolbarAct({ act: { locked, ...act }, side = false }: { act: ListCreate; side?: boolean }) {
  return (
    <Dialog
      {...act}
      trigger={{
        variant: side ? "secondary" : "primary",
        ...(side ? {} : { leadingIcon: "create" }),
        label: actLabel(act.act),
        ...(locked === undefined ? {} : { locked }),
      }}
    />
  );
}

/**
 * A toolbar act as stated, or as the read words it: its words, and `locked` while the list as read, or the reader's
 * role, shuts it. Awaiting a stated act yields it as it is.
 */
async function ToolbarActOnceRead({ act, side = false }: { act: ListCreate | Promise<ListCreate>; side?: boolean }) {
  return (
    <ToolbarAct
      act={await act}
      side={side}
    />
  );
}

/**
 * The toolbar's row: the fields from its start, and at its end the group of acts or the link. Its parts stand on their
 * feet: a filter's label stands over its field, where the search field's magnifier names it, so the fields and the
 * buttons line up by their bottoms, and centring them would lift the search field by half the label's line.
 */
const TOOLBAR_CLASSES = "flex flex-wrap items-end gap-3";

function ToolbarActs({ children }: { children: ReactNode }) {
  return <div className="ms-auto flex flex-wrap items-center justify-end gap-3">{children}</div>;
}

/**
 * A page acting on the list as a whole, such as the Sammel-Zusage: a secondary link at the toolbar row's end, its words
 * stated with the list and its address read with it, `null` where the list holds nothing it could act on.
 */
export type ListLink = { label: Copy; href: Promise<Route | null> };

async function LinkOnceRead({ link }: { link: ListLink }) {
  const href = await link.href;
  return (
    href !== null && (
      <Link
        href={href}
        placement="button"
        look="secondary"
        label={link.label}
      />
    )
  );
}

async function ListBody({ list }: { list: ListContent }) {
  switch (list.kind) {
    case "table": {
      const content = await list.content;
      // A server component hands a client element across its boundary, never a function such as a row's `onOpen`.
      if ("drawn" in content) return content.drawn;
      const { table, more } = content;
      return (
        <ListTable
          table={{ ...list.head, ...table }}
          more={more}
        />
      );
    }
    case "drawn":
      return list.content;
    case "spieltage": {
      const { tabs, empty } = await list.content;
      return tabs === null ? <EmptyBox {...empty} /> : <Spieltage {...tabs} />;
    }
    case "cards": {
      const { team, cards, seats } = await list.content;
      return (
        <>
          {team !== undefined && <TeamHead {...team} />}
          <Cards boxes={cards.length + (seats === undefined ? 0 : 1)}>
            {cards.map((entry) => (
              <ListCard
                key={entry.id}
                title={entry.title}
                {...(entry.href === undefined ? {} : { href: entry.href })}
                rows={entry.rows}
              />
            ))}
            {seats !== undefined && (
              <Card title={seats.title}>
                <SeatRows
                  label={seats.title}
                  rows={seats.rows}
                  bare
                />
              </Card>
            )}
          </Cards>
        </>
      );
    }
    case "spiele": {
      const { matches, empty } = await list.content;
      return (
        <ListMatches
          matches={matches}
          empty={empty}
        />
      );
    }
    case "tiles": {
      const { tiles, empty } = await list.content;
      return (
        <ListTiles
          tiles={tiles}
          empty={empty}
        />
      );
    }
  }
}

/**
 * The list template: the page's title in the strip; one toolbar row holding the search field where the list
 * is long enough to need one, the filter block, its values in the address, and at the row's end the act
 * creating a record over the list, a second act before it where the list holds one; then the list, drawn by its kind.
 * A list with nothing in it shows its empty state in its place.
 *
 * The page arrives whole: every part it reads, the list and whatever its read decides around it, holds the page until
 * it is rendered, and the page is sent as one document.
 */
export function ListPage({
  head,
  filters,
  create,
  side,
  link,
  list,
}: {
  head: RailPageHead;
  /** The filter block, its choices and their values read with the list, as Teams' groups are. */
  filters?: Promise<ReadonlyArray<Filter>>;
  /**
   * A record created where its list shows: the dialog's title, its act, its fields and the action. Read with the list
   * where what it makes is the list's to say, as the Saisons list names the next season, or whether it stands at all.
   */
  create?: ListCreate | Promise<ListCreate>;
  /**
   * A second act on the list as a whole, a secondary button before the create act, such as Administratoren's handover:
   * stated or read as the create act is, and shown to every reader, locked with its reason for one it does not serve.
   */
  side?: ListCreate | Promise<ListCreate>;
  link?: ListLink;
  list: ListContent;
}) {
  const search = list.kind === "table" || list.kind === "spiele" || list.kind === "tiles" ? list.search : undefined;
  const hasToolbar = search !== undefined || filters !== undefined || create !== undefined || side !== undefined || link !== undefined;

  return (
    <RailPage {...head}>
      {/* A list searched on the server opens on the search its address holds. */}
      <ListQueryScope initial={search?.address?.value}>
        {/* One toolbar row: the search at a reading width, the filters beside it, the create act at the row's
            end; on a phone the search keeps the width and the buttons share the next line. */}
        {hasToolbar && (
          <div className={TOOLBAR_CLASSES}>
            {search !== undefined && <ListSearchField {...search} />}
            {filters !== undefined && <FiltersOnceRead filters={filters} />}
            {(side !== undefined || create !== undefined) && (
              <ToolbarActs>
                {side !== undefined && (
                  <ToolbarActOnceRead
                    act={side}
                    side
                  />
                )}
                {create !== undefined && <ToolbarActOnceRead act={create} />}
              </ToolbarActs>
            )}
            {link !== undefined && (
              <div className="ms-auto">
                <LinkOnceRead link={link} />
              </div>
            )}
          </div>
        )}
        <ListBody list={list} />
      </ListQueryScope>
    </RailPage>
  );
}
