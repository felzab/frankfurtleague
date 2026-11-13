import { BracketTree } from "./BracketTree";
import { Button } from "./Button";
import { Callout } from "./Callout";
import { CappedRows } from "./CappedRows";
import { Card, CardActRow } from "./Card";
import { CardGrid } from "./CardGrid";
import { cardSurface } from "./cardStyles";
import { Dialog } from "./Dialog";
import { actLabel } from "./dialogAct";
import { EmptyBox, EmptyState } from "./EmptyState";
import { Filters } from "./Filters";
import { Link } from "./Link";
import { ListCard, ListMatches, ListQueryScope, ListSearchField, ListTable, ListTiles } from "./ListTable";
import { RailPage } from "./RailFrame";
import { SeatRows } from "./SeatRows";
import { SpielGroup } from "./SpielGroup";
import { spielColumns, spielSubgrid } from "./SpielRow";
import { Table } from "./Table";
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

/** The season's matches once read: the matchday tabs, or why there are none. */
export type SpieltageContent = {
  /** The matchday tabs; `null` while the season has no matchday yet. */
  tabs: SpieltagTabs | null;
  /** Why there is no matchday to show, standing in the tabs' place. */
  empty: EmptyStateProps;
};

/** One card per group under the page's one title, such as the Tabelle's: each group's name and count heading its table. */
type GroupsContent = {
  groups: ReadonlyArray<{ id: string; title: Copy; table: TableBody }>;
  /** Why there is no group to show, standing in the tables' place. */
  empty: EmptyStateProps;
};

/**
 * Open work, one card per kind in its order of reading, such as the administrator's Übersicht: each card's title and
 * count over its records, the first five of a longer card's rows and the rest a press away (`CappedRows`), five of what
 * the search leaves on a page a search narrows, every card drawn every day, one with nothing waiting saying so.
 */
type CardsContent = {
  /** The team whose own Übersicht this is, heading the cards: its plaque and its full name (`TeamHead`). */
  team?: ComponentProps<typeof TeamHead>;
  cards: ReadonlyArray<{
    id: string;
    title: Copy;
    /** Each row, with the words the list's search narrows it by where more than its name is searched. */
    rows: ReadonlyArray<CardActRowProps & { id: string; words?: string }>;
    /** `false` on a card holding a list rather than open work, such as a referee's games: a count says how much is open. */
    count?: false;
    /**
     * Such a list's own empty state, which stands in the card's place while the list holds nothing or a search finds
     * nothing in it; a card of open work stays and says „Nichts offen.“
     */
    empty?: EmptyStateProps;
  }>;
  /**
   * Who holds the seats of the record the work belongs to, such as a team's on its own Übersicht: the last card, which
   * only shows them, so a seat carries no act.
   */
  seats?: { title: Copy; rows: ReadonlyArray<Omit<SeatRow, "acts">> };
};

/** The K.-o.-Baum, or why there is none yet. */
type TreeContent = {
  /** The tree's rounds and the third place; `null` before the draw. */
  tree: ComponentProps<typeof BracketTree> | null;
  empty: EmptyStateProps;
};

/** One club's matches, each under its matchday's head, and why there are none. */
type SpielGroupsContent = { groups: ReadonlyArray<{ head: Copy; spiel: SpielRowProps & { id: string } }>; empty: EmptyStateProps };

/** Matches the filters left, each with the words the search narrows them by, and why there are none. */
type SpieleContent = { matches: ReadonlyArray<{ row: SpielRowProps & { id: string }; words: string }>; empty: EmptyStateProps };

/** Clubs the filters left as school tiles, each with the words the search narrows them by, and why there are none. */
type TilesContent = { tiles: ReadonlyArray<{ tile: SchoolTile; words: string }>; empty: EmptyStateProps };

/** What the list shows, by its kind, and the content the kind is drawn from once it is read. */
type ListContent =
  | {
      kind: "table";
      /** The search field's name, where the list holds about 20 rows or more. */ search?: ListSearch;
      /** The table's head, over the rows the read brings. */
      head: TableHead;
      content: Promise<TableContent>;
    }
  | {
      kind: "folds";
      /** `ReadFolds` over the cards, in a `column`: a page folding nothing ships none of the fold's client code. */
      content: Promise<ReactElement>;
    }
  | {
      kind: "spieltage";
      content: Promise<SpieltageContent>;
    }
  | {
      kind: "groups";
      /** Every group's table's head, one for all. */
      head: TableHead;
      content: Promise<GroupsContent>;
    }
  | {
      kind: "cards";
      /** The search field's name, where a card's list can reach about 20 rows, as a table's takes it. */
      search?: ListSearch;
      content: Promise<CardsContent>;
    }
  | {
      kind: "tree";
      content: Promise<TreeContent>;
    }
  | {
      kind: "spiele";
      /** The search field's name. */
      search: ListSearch;
      content: Promise<SpieleContent>;
    }
  | {
      kind: "spielGroups";
      content: Promise<SpielGroupsContent>;
    }
  | {
      kind: "tiles";
      /** The search field's name. */
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

/** A group's own box, handing the list's columns on to its match; a container would stop them (`SpielCards`). */
const SPIEL_CARD_CLASSES = cardSurface({ class: `overflow-hidden ${spielSubgrid()}` });

/**
 * A club's matches one under another at every width, each in its own box under its matchday's head. The list holds the
 * matches' columns (`spielColumns`), so every group's score and sides stand at one x down the list, as a table's rows do,
 * and it is the container whose width picks the rows' form: the one line where the content is wide enough, the card a
 * phone shows below it. The boxes cannot be the containers: a container establishes an independent formatting context,
 * and a grid that does is no subgrid, so the box would drop the columns it hands on.
 */
function SpielCards({ children }: { children: ReactNode }) {
  return <div className={spielColumns({ class: "@container gap-y-3" })}>{children}</div>;
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

/** The filter block once its choices are read. */
async function FiltersOnceRead({ filters }: { filters: Promise<ReadonlyArray<Filter>> }) {
  return <Filters filters={await filters} />;
}

/**
 * A record created where its list shows: the dialog's act, and why it cannot run on the list as it stands, which the
 * page read, the button saying why (`Button`).
 */
export type ListCreate = DialogAct & { locked?: Copy };

/**
 * An act at the toolbar row's end, its button opening the dialog over the list: the create act, or as `side` the second
 * act before it, a secondary button.
 */
function ToolbarAct({ act: { locked, ...act }, side = false }: { act: ListCreate; side?: boolean }) {
  const face = {
    variant: side ? "secondary" : "primary",
    ...(side ? {} : { leadingIcon: "create" as const }),
    label: actLabel(act.act),
  } as const;
  return locked === undefined ? (
    <Dialog
      {...act}
      trigger={face}
    />
  ) : (
    <Button
      {...face}
      locked={locked}
    />
  );
}

/** A toolbar act once what it makes is read. */
async function ToolbarActOnceRead({ act, side }: { act: Promise<ListCreate>; side: boolean }) {
  return (
    <ToolbarAct
      act={await act}
      side={side}
    />
  );
}

/**
 * A toolbar act as stated, or as the read words it: its words, and `locked` while the list as read, or the reader's
 * role, shuts it.
 */
function ToolbarActOf({ act, side = false }: { act: ListCreate | Promise<ListCreate>; side?: boolean }) {
  return act instanceof Promise ? (
    <ToolbarActOnceRead
      act={act}
      side={side}
    />
  ) : (
    <ToolbarAct
      act={act}
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

/** That link once the list says whether it stands. */
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

/** The standing word over a list read short, once the list says so. */
async function NoticeOnceRead({ notice }: { notice: Promise<Copy | null> }) {
  const text = await notice;
  return (
    text !== null && (
      <Callout
        tone="warn"
        text={text}
      />
    )
  );
}

/** The list once its content is read. */
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
    case "folds":
      return list.content;
    case "spieltage": {
      const { tabs, empty } = await list.content;
      return tabs === null ? <EmptyBox {...empty} /> : <Spieltage {...tabs} />;
    }
    case "groups": {
      const { groups, empty } = await list.content;
      return groups.length === 0 ? (
        <EmptyBox {...empty} />
      ) : (
        groups.map((group) => (
          <Card
            key={group.id}
            title={group.title}
            count={group.table.rows.length}>
            <Table
              {...list.head}
              {...group.table}
              bare
            />
          </Card>
        ))
      );
    }
    case "cards": {
      const { team, cards, seats } = await list.content;
      return (
        <>
          {team !== undefined && <TeamHead {...team} />}
          <Cards boxes={cards.length + (seats === undefined ? 0 : 1)}>
            {cards.map((entry) =>
              // A searched card is drawn where the search is held, since which rows it caps depends on the text typed.
              list.search !== undefined ? (
                <ListCard
                  key={entry.id}
                  title={entry.title}
                  rows={entry.rows}
                  {...(entry.count === false ? { count: false } : {})}
                  {...(entry.empty === undefined ? {} : { empty: entry.empty })}
                />
              ) : entry.rows.length === 0 && entry.empty !== undefined ? (
                <EmptyBox
                  key={entry.id}
                  {...entry.empty}
                />
              ) : (
                <Card
                  key={entry.id}
                  title={entry.title}
                  {...(entry.count === false ? {} : { count: entry.rows.length })}>
                  {entry.rows.length === 0 ? (
                    <EmptyState kind="clear" />
                  ) : (
                    <CappedRows
                      rows={entry.rows.map(({ id, words: _words, ...row }) => (
                        <CardActRow
                          key={id}
                          {...row}
                        />
                      ))}
                    />
                  )}
                </Card>
              ),
            )}
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
    case "tree": {
      const { tree, empty } = await list.content;
      return tree === null ? <EmptyBox {...empty} /> : <BracketTree {...tree} />;
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
    case "spielGroups": {
      const { groups, empty } = await list.content;
      return groups.length === 0 ? (
        <EmptyBox {...empty} />
      ) : (
        <SpielCards>
          {groups.map((group) => (
            <div
              key={group.spiel.id}
              className={SPIEL_CARD_CLASSES}>
              <SpielGroup
                head={group.head}
                spiele={[group.spiel]}
                columns="outer"
              />
            </div>
          ))}
        </SpielCards>
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
 * creating a record over the list, a second act before it where the list holds one; then the list. The list is a
 * table whose rows open their records or carry their acts, „Weitere 50 laden“ under it only while the server reports
 * more rows; or, for the season's matches, the matchday tabs, one matchday at a time, opening on the one the server
 * names; or folded cards of tables, as Administratoren sets what stands over what waits; or one card per group, its
 * head naming the group over its table, as the Tabelle stands its groups one under another; or open work
 * as cards of rows, two a row from 42 rem of their grid, as the Übersicht sets its kinds, a team's own under the team's head and
 * closing with a card of its seats, and a lone card, such as a referee's games, at the content's width; or the K.-o.-Baum; or matches the
 * filters left, which the search narrows, as the Spielsuche lists them; or one club's matches, each in its own box
 * under its matchday's head, as a team's Spiele lists them; or the
 * clubs the filters left as school tiles, which the search narrows, as Teams lists them. A list with nothing
 * in it shows its empty state in its place.
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
  notice,
  list,
}: {
  head: RailPageHead;
  /** The filter block, its choices and their values read with the list, as the Spielsuche's clubs and matchdays are. */
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
  /** What holds of the list as read and no row says, standing between the toolbar and the list. */
  notice?: Promise<Copy | null>;
  list: ListContent;
}) {
  const search = list.kind === "table" || list.kind === "spiele" || list.kind === "tiles" || list.kind === "cards" ? list.search : undefined;
  const hasToolbar = search !== undefined || filters !== undefined || create !== undefined || side !== undefined || link !== undefined;

  return (
    <RailPage {...head}>
      <ListQueryScope>
        {/* One toolbar row: the search at a reading width, the filters beside it, the create act at the row's
            end; on a phone the search keeps the width and the buttons share the next line. */}
        {hasToolbar && (
          <div className={TOOLBAR_CLASSES}>
            {search !== undefined && <ListSearchField {...search} />}
            {filters !== undefined && <FiltersOnceRead filters={filters} />}
            {(side !== undefined || create !== undefined) && (
              <ToolbarActs>
                {side !== undefined && (
                  <ToolbarActOf
                    act={side}
                    side
                  />
                )}
                {create !== undefined && <ToolbarActOf act={create} />}
              </ToolbarActs>
            )}
            {link !== undefined && (
              <div className="ms-auto">
                <LinkOnceRead link={link} />
              </div>
            )}
          </div>
        )}
        {notice !== undefined && <NoticeOnceRead notice={notice} />}
        <ListBody list={list} />
      </ListQueryScope>
    </RailPage>
  );
}
