import { Suspense } from "react";

import { COPY } from "@/core/copy";

import { BracketTree, BracketTreePlaceholder } from "./BracketTree";
import { Button } from "./Button";
import { buttonPlaceholder } from "./buttonStyles";
import { Callout } from "./Callout";
import { Card, CardActRow, CardPlaceholder, CardRowsPlaceholder } from "./Card";
import { CardGrid } from "./CardGrid";
import { cardSurface } from "./cardStyles";
import { Dialog } from "./Dialog";
import { actLabel } from "./dialogAct";
import { EmptyBox, EmptyState } from "./EmptyState";
import { FieldPlaceholder } from "./FieldPair";
import { Filters } from "./Filters";
import { Icon } from "./Icon";
import { Link } from "./Link";
import { ListCard, ListMatches, ListQueryScope, ListSearchField, ListTable, ListTiles } from "./ListTable";
import { PageWait } from "./PageFade";
import { RailPage } from "./RailFrame";
import { RowActs } from "./RowActs";
import { SeatRows, SeatRowsPlaceholder } from "./SeatRows";
import { Placeholder, Waiting } from "./Skeleton";
import { SpielGroup, SpielGroupPlaceholder } from "./SpielGroup";
import { spielColumns, SpielListPlaceholder, spielSubgrid } from "./SpielRow";
import { SpieltagHeadPlaceholder } from "./SpieltagHead";
import { Table, TablePlaceholder } from "./Table";
import { Tabs, TabsPlaceholder } from "./Tabs";
import { TeamHead, TeamHeadPlaceholder } from "./TeamHead";
import { SchoolTilesPlaceholder } from "./TileGrid";

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
 * Open work, one card per kind in its order of reading, such as the administrator's Übersicht: each card's title
 * over its records, every card drawn every day, one with nothing waiting saying so.
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
type SpielGroupsContent = { groups: ReadonlyArray<ComponentProps<typeof SpielGroup>>; empty: EmptyStateProps };

/** Matches the filters left, each with the words the search narrows them by, and why there are none. */
type SpieleContent = { matches: ReadonlyArray<{ row: SpielRowProps & { id: string }; words: string }>; empty: EmptyStateProps };

/** Clubs the filters left as school tiles, each with the words the search narrows them by, and why there are none. */
type TilesContent = { tiles: ReadonlyArray<{ tile: SchoolTile; words: string }>; empty: EmptyStateProps };

/**
 * What the list shows, by its kind, which is known before its content is read: the kind decides the shape
 * the wait is drawn in.
 */
type ListContent =
  | {
      kind: "table";
      /** The search field's name, where the list holds about 20 rows or more. */ search?: ListSearch;
      /** The table's head, which its placeholder draws while the rows are read. */
      head: TableHead;
      /** How many rows its wait draws. */
      wait: number;
      /** „Weitere 50 laden“ stands under the list as a rule, so its wait draws the button. */
      paged?: true;
      content: Promise<TableContent>;
    }
  | {
      kind: "folds";
      /** The cards while they wait, `OpenFoldPlaceholder`, which the page places as it places the cards. */
      wait: ReactElement;
      /** `ReadFolds` over the cards, in a `column`: a page folding nothing ships none of the fold's client code. */
      content: Promise<ReactElement>;
    }
  | {
      kind: "spieltage";
      /** Each matchday's panel opens with its dates and its act, as the administrator's „Spiele“ list's do. */
      dated?: true;
      /** How many matchday tabs its wait draws, and how many matches under them. */
      wait: { tabs: number; matches: number };
      content: Promise<SpieltageContent>;
    }
  | {
      kind: "groups";
      /** Every group's table's head, one for all, which their placeholder draws while the rows are read. */
      head: TableHead;
      /** How many group cards its wait draws, and how many rows in each. */
      wait: { groups: number; rows: number };
      content: Promise<GroupsContent>;
    }
  | {
      kind: "cards";
      /** The search field's name, where a card's list can reach about 20 rows, as a table's takes it. */
      search?: ListSearch;
      /**
       * Each card while it waits, in their order, its title, the acts its rows carry, which a phone sets on a line of
       * their own, and `count` as the card states it, and how many rows each draws; the seats' card's title, where
       * the page shows the record's seats; and `team` where a team's head opens the page.
       */
      wait: {
        rows: number;
        cards: ReadonlyArray<{ title: Copy; acts?: ReadonlyArray<Copy>; count?: false }>;
        seats?: Copy;
        team?: true;
      };
      content: Promise<CardsContent>;
    }
  | {
      kind: "tree";
      /** How many teams its wait draws the tree for, which is the tree's shape. */
      wait: ComponentProps<typeof BracketTreePlaceholder>["qualifiers"];
      content: Promise<TreeContent>;
    }
  | {
      kind: "spiele";
      /** The search field's name. */
      search: ListSearch;
      /** How many match cards its wait draws. */
      wait: number;
      content: Promise<SpieleContent>;
    }
  | {
      kind: "spielGroups";
      /** How many match cards its wait draws. */
      wait: number;
      content: Promise<SpielGroupsContent>;
    }
  | {
      kind: "tiles";
      /** The search field's name. */
      search: ListSearch;
      /** How many tiles its wait draws. */
      wait: number;
      content: Promise<TilesContent>;
    };

/**
 * What each kind waits in: the placeholders of the blocks its content is drawn with, laid out as the content lays them,
 * as many as the page states beside its list (`Skeleton.tsx` has the rule), since how many there are is what the read
 * tells.
 */
function ListPlaceholder({ list }: { list: ListContent }) {
  switch (list.kind) {
    case "table":
      return (
        <>
          <TablePlaceholder
            head={list.head}
            rows={list.wait}
          />
          {list.paged === true && (
            <div className="flex items-center gap-3">
              <span className={buttonPlaceholder()}>{COPY.shared.loadMore}</span>
            </div>
          )}
        </>
      );
    case "folds":
      return list.wait;
    case "groups":
      return Array.from({ length: list.wait.groups }, (_, index) => (
        <CardPlaceholder
          key={index}
          count>
          <TablePlaceholder
            head={list.head}
            rows={list.wait.rows}
            plaques
            bare
          />
        </CardPlaceholder>
      ));
    case "cards":
      return (
        <>
          {list.wait.team === true && <TeamHeadPlaceholder />}
          <Cards boxes={list.wait.cards.length + (list.wait.seats === undefined ? 0 : 1)}>
            {list.wait.cards.map(({ title, acts, count }) => (
              <CardPlaceholder
                key={title}
                title={title}
                count={count !== false}>
                <CardRowsPlaceholder
                  rows={list.wait.rows}
                  {...(acts === undefined ? {} : { acts })}
                />
              </CardPlaceholder>
            ))}
            {list.wait.seats !== undefined && (
              <CardPlaceholder title={list.wait.seats}>
                <SeatRowsPlaceholder
                  bare
                  readOnly
                />
              </CardPlaceholder>
            )}
          </Cards>
        </>
      );
    case "spieltage":
      return (
        <TabsPlaceholder count={list.wait.tabs}>
          {list.dated === true && <SpieltagHeadPlaceholder />}
          <SpielListPlaceholder
            count={list.wait.matches}
            layout="cards"
          />
        </TabsPlaceholder>
      );
    case "tree":
      return <BracketTreePlaceholder qualifiers={list.wait} />;
    case "spiele":
      return (
        <SpielListPlaceholder
          count={list.wait}
          layout="cards"
        />
      );
    case "spielGroups":
      return (
        <SpielCards>
          {Array.from({ length: list.wait }, (_, index) => (
            <div
              key={index}
              className={SPIEL_CARD_CLASSES}>
              <SpielGroupPlaceholder columns="outer" />
            </div>
          ))}
        </SpielCards>
      );
    case "tiles":
      return <SchoolTilesPlaceholder count={list.wait} />;
  }
}

/** What a list's boundary holds while its blocks are read, laid out as the blocks will be. */
function ListWait({ children }: { children: ReactNode }) {
  return <Waiting layoutClass="flex flex-col gap-6">{children}</Waiting>;
}

/**
 * A page's cards: side by side in the grid, or a lone one at the content's width, beside which the grid's second column
 * would stand empty. The wait and the page each count their own, so both stand alike.
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

/**
 * The filter block while its choices are read, at the height it will stand at, so nothing under the toolbar moves when
 * it arrives: on a phone the „Filter“ button, on desktop its labelled selects, each its label, its field and the line
 * under it.
 */
function FiltersPlaceholder({ count }: { count: number }) {
  return (
    <Placeholder>
      <span className={buttonPlaceholder("lg:hidden")}>
        <Icon
          glyph="filter"
          size={16}
        />
        {COPY.shared.filter}
      </span>
      <span className="flex items-start gap-3 max-lg:hidden">
        {Array.from({ length: count }, (_, index) => (
          // A filter's select at the least width its row gives it (`./Filters.tsx`).
          <span
            key={index}
            className="w-40">
            <FieldPlaceholder />
          </span>
        ))}
      </span>
    </Placeholder>
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

/** A toolbar act the read words: its words, which its wait draws at their width, and the act, `locked` while the list as read shuts it. */
export type ListActOnceRead = { label: Copy; act: Promise<ListCreate> };

/** The toolbar's acts where the reader's role decides them, each `null` for a reader who does not hold it. */
export type ListRoleActs = { side: ListCreate | null; create: ListCreate | null };

/**
 * The create act while what it makes is read: its button's placeholder, so the toolbar keeps its height.
 */
function CreatePlaceholder({ label }: { label: Copy }) {
  return (
    <Placeholder>
      <span className={buttonPlaceholder()}>
        <Icon
          glyph="create"
          size={16}
        />
        {label}
      </span>
    </Placeholder>
  );
}

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
    // The act that locks it takes its trigger along: a handover's start, whose button stands again unbound to its dialog.
    <RowActs className="contents">
      <Dialog
        {...act}
        trigger={face}
      />
    </RowActs>
  ) : (
    <Button
      {...face}
      locked={locked}
    />
  );
}

/** A toolbar act once what it makes is read. */
async function ToolbarActOnceRead({ act }: { act: Promise<ListCreate> }) {
  return <ToolbarAct act={await act} />;
}

/** The toolbar's row: the fields from its start, and at its end the group of acts or the link. */
const TOOLBAR_CLASSES = "flex flex-wrap items-center gap-3";

/** The acts at the toolbar row's end, where focus lands when an act takes the control it was on with it. */
function ToolbarActs({ children }: { children: ReactNode }) {
  return (
    <div
      data-kit-focus="home"
      className="ms-auto flex flex-wrap items-center justify-end gap-3">
      {children}
    </div>
  );
}

/** The toolbar of a reader the role's acts reach, and no row for any other, whose empty row would hold the page's gap. */
async function RoleActsOnceRead({ acts }: { acts: Promise<ListRoleActs> }) {
  const { side, create } = await acts;
  if (side === null && create === null) return null;
  return (
    <div className={TOOLBAR_CLASSES}>
      <ToolbarActs>
        {side !== null && (
          <ToolbarAct
            act={side}
            side
          />
        )}
        {create !== null && <ToolbarAct act={create} />}
      </ToolbarActs>
    </div>
  );
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

/** The list once its content is read, in the boundary's place. */
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
              // A searched card is drawn where the search is held, since what it shows depends on the text typed.
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
                    entry.rows.map(({ id, words: _words, ...row }) => (
                      <CardActRow
                        key={id}
                        {...row}
                      />
                    ))
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
                {...group}
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
 * as cards of rows, two a row from `lg`, as the Übersicht sets its kinds, a team's own under the team's head and
 * closing with a card of its seats, and a lone card, such as a referee's games, at the content's width; or the K.-o.-Baum; or matches the
 * filters left, which the search narrows, as the Spielsuche lists them; or one club's matches, each in its own box
 * under its matchday's head, as a team's Spiele lists them; or the
 * clubs the filters left as school tiles, which the search narrows, as Teams lists them. A list with nothing
 * in it shows its empty state in its place.
 *
 * The title and the toolbar are drawn at once; the list waits for its content, in the template's one boundary with what
 * its read decides above it, drawn meanwhile as the placeholders of the blocks it will be drawn with. Typing into the
 * search field before the rows arrive searches them once they do.
 */
export function ListPage({
  head,
  filters,
  filterCount = 1,
  create,
  acts,
  link,
  notice,
  list,
}: {
  head: RailPageHead;
  /**
   * The filter block, its choices and their values read with the list, as the Spielsuche's clubs and matchdays
   * are, so it waits in a boundary of its own and stands in the toolbar once read.
   */
  filters?: Promise<ReadonlyArray<Filter>>;
  /** How many selects the filter block holds, which the page knows before the read and its wait draws. */
  filterCount?: number;
  /**
   * A record created where its list shows: the dialog's title, its act, its fields and the action. Read with the list
   * where what it makes is the list's to say, as the Saisons list names the next season, or whether it stands at all, so
   * it waits in a boundary of its own and stands in the toolbar once read.
   */
  create?: ListCreate | ListActOnceRead;
  /**
   * The acts one role alone holds, read with the list, as Administratoren's: the create act, and before it a second act
   * on the list as a whole, a secondary button. No wait draws them. What a reader sees of an ordinary load's wait is the
   * static shell's (`PageWaitOnceRead`), which knows no reader, so a placeholder would show every other role an act it
   * does not hold and then lift its list. Every role waits alike, and the toolbar arrives with the list for the role
   * holding it, moving the list down by its own height. It stands in the list's boundary: in one of its own, React's
   * reveal throttle can land the rows 300 ms ahead of it, and it then lifts them under a finger on a row's act.
   */
  acts?: Promise<ListRoleActs>;
  link?: ListLink;
  /**
   * What holds of the list as read and no row says, standing between the toolbar and the list, in the list's boundary as
   * `acts` are, for the same reason.
   */
  notice?: Promise<Copy | null>;
  list: ListContent;
}) {
  const search = list.kind === "table" || list.kind === "spiele" || list.kind === "tiles" || list.kind === "cards" ? list.search : undefined;
  const hasToolbar = search !== undefined || filters !== undefined || create !== undefined || link !== undefined;

  return (
    <RailPage {...head}>
      <ListQueryScope>
        {/* One toolbar row: the search at a reading width, the filters beside it, the create act at the row's
            end; on a phone the search keeps the width and the buttons share the next line. */}
        {hasToolbar && (
          <div className={TOOLBAR_CLASSES}>
            {search !== undefined && <ListSearchField {...search} />}
            {filters !== undefined && (
              <Suspense fallback={<FiltersPlaceholder count={filterCount} />}>
                <FiltersOnceRead filters={filters} />
              </Suspense>
            )}
            {create !== undefined && (
              <ToolbarActs>
                {"label" in create ? (
                  <Suspense fallback={<CreatePlaceholder label={create.label} />}>
                    <ToolbarActOnceRead act={create.act} />
                  </Suspense>
                ) : (
                  <ToolbarAct act={create} />
                )}
              </ToolbarActs>
            )}
            {link !== undefined && (
              <div className="ms-auto">
                <Suspense
                  fallback={
                    <Placeholder>
                      <span className={buttonPlaceholder()}>{link.label}</span>
                    </Placeholder>
                  }>
                  <LinkOnceRead link={link} />
                </Suspense>
              </div>
            )}
          </div>
        )}
        <PageWait
          fallback={
            <ListWait>
              <ListPlaceholder list={list} />
            </ListWait>
          }>
          {acts !== undefined && <RoleActsOnceRead acts={acts} />}
          {notice !== undefined && <NoticeOnceRead notice={notice} />}
          <ListBody list={list} />
        </PageWait>
      </ListQueryScope>
    </RailPage>
  );
}
