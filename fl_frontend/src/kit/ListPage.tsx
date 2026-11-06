import { Suspense } from "react";

import { COPY } from "@/core/copy";

import { BracketTree, BracketTreePlaceholder } from "./BracketTree";
import { Button } from "./Button";
import { buttonPlaceholder } from "./buttonStyles";
import { Card, CardActRow, CardPlaceholder, CardRowsPlaceholder } from "./Card";
import { CardGrid } from "./CardGrid";
import { cardSurface } from "./cardStyles";
import { Dialog } from "./Dialog";
import { actLabel } from "./dialogAct";
import { EmptyState } from "./EmptyState";
import { FieldPlaceholder } from "./FieldPair";
import { StatusLine } from "./FieldParts";
import { Filters } from "./Filters";
import { Icon } from "./Icon";
import { ListMatches, ListQueryScope, ListSearchField, ListTable, ListTiles } from "./ListTable";
import { lockedLine } from "./lockedLine";
import { PageWait } from "./PageFade";
import { RailPage } from "./RailFrame";
import { Placeholder, SAISON_WORDS, Waiting } from "./Skeleton";
import { SpielListPlaceholder } from "./SpielRow";
import { SpieltagHeadPlaceholder } from "./SpieltagHead";
import { Table, TablePlaceholder } from "./Table";
import { Tabs, TabsPlaceholder } from "./Tabs";
import { SchoolTilesPlaceholder } from "./TileGrid";

import type { Copy } from "@/core/copy";
import type { ComponentProps, ReactNode } from "react";
import type { CardActRowProps } from "./Card";
import type { DialogAct } from "./dialogAct";
import type { EmptyStateProps } from "./EmptyState";
import type { Filter } from "./Filters";
import type { ListMore, ListSearch } from "./ListTable";
import type { RailPageHead } from "./RailFrame";
import type { SpielRowProps } from "./SpielRow";
import type { TableBody, TableHead } from "./Table";
import type { SchoolTile } from "./TileGrid";

/** The matchday tabs, each with its matches, and the tab the server chose by `chosenTab`. */
type SpieltagTabs = {
  label: Copy;
  selectedKey: string;
  tabs: ReadonlyArray<{ id: string; label: Copy; panel: ReactNode }>;
};

/** A table's rows, and how a list past one read's cap reaches the rest; its head is the list's, stated before the read. */
type TableContent = { table: TableBody; more?: ListMore };

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
  cards: ReadonlyArray<{ id: string; title: Copy; rows: ReadonlyArray<CardActRowProps & { id: string }> }>;
};

/** The K.-o.-Baum, or why there is none yet. */
type TreeContent = {
  /** The tree's rounds and the third place; `null` before the draw. */
  tree: ComponentProps<typeof BracketTree> | null;
  empty: EmptyStateProps;
};

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
      content: Promise<TableContent>;
    }
  | {
      kind: "spieltage";
      /** Each matchday's panel opens with its dates and its act, as the administrator's „Spiele“ list's do. */
      dated?: true;
      content: Promise<SpieltageContent>;
    }
  | {
      kind: "groups";
      /** Every group's table's head, one for all, which their placeholder draws while the rows are read. */
      head: TableHead;
      content: Promise<GroupsContent>;
    }
  | {
      kind: "cards";
      /** Each card while it waits, in their order: its title, and the acts its rows carry, which a phone sets on a line of their own. */
      wait: ReadonlyArray<{ title: Copy; acts?: ReadonlyArray<Copy> }>;
      content: Promise<CardsContent>;
    }
  | { kind: "tree"; content: Promise<TreeContent> }
  | { kind: "spiele"; /** The search field's name. */ search: ListSearch; content: Promise<SpieleContent> }
  | { kind: "tiles"; /** The search field's name. */ search: ListSearch; content: Promise<TilesContent> };

/**
 * What each kind waits in: the placeholders of the blocks its content is drawn with, laid out as the content lays them,
 * so the wait stands as tall as the first screen of the content will. How many rows, cards or tiles it draws is a
 * typical first screen's, since how many there are is what the read tells.
 */
function ListPlaceholder({ list }: { list: ListContent }) {
  switch (list.kind) {
    case "table":
      return (
        <TablePlaceholder
          head={list.head}
          rows={8}
        />
      );
    case "groups":
      return [0, 1].map((index) => (
        <CardPlaceholder
          key={index}
          count>
          <TablePlaceholder
            head={list.head}
            rows={4}
            plaques
            bare
          />
        </CardPlaceholder>
      ));
    case "cards":
      return (
        <CardGrid>
          {list.wait.map(({ title, acts }) => (
            <CardPlaceholder
              key={title}
              title={title}
              count>
              <CardRowsPlaceholder
                rows={3}
                {...(acts === undefined ? {} : { acts })}
              />
            </CardPlaceholder>
          ))}
        </CardGrid>
      );
    case "spieltage":
      return (
        <TabsPlaceholder count={6}>
          {list.dated === true && <SpieltagHeadPlaceholder />}
          <SpielListPlaceholder
            count={6}
            layout="cards"
          />
        </TabsPlaceholder>
      );
    case "tree":
      return <BracketTreePlaceholder />;
    case "spiele":
      return (
        <SpielListPlaceholder
          count={6}
          layout="cards"
        />
      );
    case "tiles":
      return <SchoolTilesPlaceholder count={8} />;
  }
}

/** A list's empty state inside the list's box, as `Table` places its own. */
function EmptyBox({ empty }: { empty: EmptyStateProps }) {
  return (
    <div className={cardSurface({ class: "overflow-hidden" })}>
      <EmptyState {...empty} />
    </div>
  );
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
 * it arrives: on a phone the „Filter“ button, on desktop a labelled select, its label, its field and the line under it.
 */
function FiltersPlaceholder() {
  return (
    <Placeholder>
      <span className={buttonPlaceholder("lg:hidden")}>
        <Icon
          glyph="filter"
          size={16}
        />
        {COPY.shared.filter}
      </span>
      <span className="max-lg:hidden">
        <FieldPlaceholder width="C10" />
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
 * page read, the button disabled and the reason in the line under it.
 */
export type ListCreate = DialogAct & { locked?: Copy };

/**
 * The create act while what it makes is read: its button's placeholder, so the toolbar keeps its height. A list reads
 * its act's words alone where they name the next season, so the placeholder names a season, any season's name as wide.
 */
function CreatePlaceholder() {
  return (
    <Placeholder>
      <span className={buttonPlaceholder()}>
        <Icon
          glyph="create"
          size={16}
        />
        {actLabel({ verb: "create", object: SAISON_WORDS })}
      </span>
    </Placeholder>
  );
}

/**
 * The create act at the toolbar row's end, its button opening the dialog over the list. Its reason, where it cannot
 * run, stands under the button in the gap between the toolbar and the list, outside the toolbar's flow, so a create
 * closing the act, as a new season closes the next, moves neither the toolbar nor the list, and the toolbar's parts
 * stay centred on one line. It is placed against the toolbar, the act's own box being only as wide as its button.
 */
function CreateAct({ create }: { create: ListCreate }) {
  const { locked, ...act } = create;
  return (
    <>
      <Dialog
        {...act}
        trigger={
          <Button
            variant="primary"
            leadingIcon="create"
            label={actLabel(act.act)}
            isDisabled={locked !== undefined}
          />
        }
      />
      {locked !== undefined && (
        <div className="absolute end-0 top-full mt-1 text-end">
          <StatusLine
            status={lockedLine(locked)}
            placement="column"
          />
        </div>
      )}
    </>
  );
}

/** The create act once what it makes is read. */
async function CreateOnceRead({ create }: { create: Promise<ListCreate> }) {
  return <CreateAct create={await create} />;
}

/** The list once its content is read, in the boundary's place. */
async function ListBody({ list }: { list: ListContent }) {
  switch (list.kind) {
    case "table": {
      const { table, more } = await list.content;
      return (
        <ListTable
          table={{ ...list.head, ...table }}
          more={more}
        />
      );
    }
    case "spieltage": {
      const { tabs, empty } = await list.content;
      return tabs === null ? <EmptyBox empty={empty} /> : <Spieltage {...tabs} />;
    }
    case "groups": {
      const { groups, empty } = await list.content;
      return groups.length === 0 ? (
        <EmptyBox empty={empty} />
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
      const { cards } = await list.content;
      return (
        <CardGrid>
          {cards.map((entry) => (
            <Card
              key={entry.id}
              title={entry.title}
              count={entry.rows.length}>
              {entry.rows.length === 0 ? (
                <EmptyState kind="clear" />
              ) : (
                entry.rows.map(({ id, ...row }) => (
                  <CardActRow
                    key={id}
                    {...row}
                  />
                ))
              )}
            </Card>
          ))}
        </CardGrid>
      );
    }
    case "tree": {
      const { tree, empty } = await list.content;
      return tree === null ? <EmptyBox empty={empty} /> : <BracketTree {...tree} />;
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
 * creating a record over the list; then the list. The list is a table whose rows open their records,
 * „Weitere 50 laden“ under it only while the server reports more rows; or, for the season's matches, the
 * matchday tabs, one matchday at a time, opening on the one the server names; or one card per group, its
 * head naming the group over its table, as the Tabelle stands its groups one under another; or open work
 * as cards of rows, two a row from `lg`, as the Übersicht sets its kinds; or the K.-o.-Baum; or matches the filters left, which the search narrows, as the Spielsuche lists them; or the
 * clubs the filters left as school tiles, which the search narrows, as Teams lists them. A list with nothing
 * in it shows its empty state in its place.
 *
 * The title and the toolbar are drawn at once; the list alone waits for its content, in the template's one
 * boundary, drawn meanwhile as the placeholders of the blocks it will be drawn with. Typing into the search field before the rows arrive
 * searches them once they do.
 */
export function ListPage({
  head,
  filters,
  create,
  list,
}: {
  head: RailPageHead;
  /**
   * The filter block, its choices and their values read with the list, as the Spielsuche's clubs and matchdays
   * are, so it waits in a boundary of its own and stands in the toolbar once read.
   */
  filters?: Promise<ReadonlyArray<Filter>>;
  /**
   * A record created where its list shows: the dialog's title, its act, its fields and the action. Read with the list
   * where what it makes is the list's to say, as the Saisons list names the next season, so it waits in a boundary of
   * its own and stands in the toolbar once read.
   */
  create?: ListCreate | Promise<ListCreate>;
  list: ListContent;
}) {
  const search = list.kind === "table" || list.kind === "spiele" || list.kind === "tiles" ? list.search : undefined;
  const hasToolbar = search !== undefined || filters !== undefined || create !== undefined;

  return (
    <RailPage {...head}>
      <ListQueryScope>
        {/* One toolbar row: the search at a reading width, the filters beside it, the create act at the row's
            end; on a phone the search keeps the width and the buttons share the next line. */}
        {hasToolbar && (
          // Positioned, so the create act's reason stands under the toolbar's end, in the gap above the list.
          <div className="relative flex flex-wrap items-center gap-3">
            {search !== undefined && <ListSearchField label={search.label} />}
            {filters !== undefined && (
              <Suspense fallback={<FiltersPlaceholder />}>
                <FiltersOnceRead filters={filters} />
              </Suspense>
            )}
            {create !== undefined && (
              <div className="ms-auto">
                {create instanceof Promise ? (
                  <Suspense fallback={<CreatePlaceholder />}>
                    <CreateOnceRead create={create} />
                  </Suspense>
                ) : (
                  <CreateAct create={create} />
                )}
              </div>
            )}
          </div>
        )}
        <PageWait
          fallback={
            <Waiting layout="flex flex-col gap-6">
              <ListPlaceholder list={list} />
            </Waiting>
          }>
          <ListBody list={list} />
        </PageWait>
      </ListQueryScope>
    </RailPage>
  );
}
