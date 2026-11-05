import { Suspense } from "react";

import { BracketTree } from "./BracketTree";
import { Button } from "./Button";
import { Card, CardActRow } from "./Card";
import { CardGrid } from "./CardGrid";
import { cardSurface } from "./cardStyles";
import { Dialog } from "./Dialog";
import { actLabel } from "./dialogAct";
import { EmptyState } from "./EmptyState";
import { Filters } from "./Filters";
import { ListMatches, ListQueryScope, ListSearchField, ListTable, ListTiles } from "./ListTable";
import { PageWait } from "./PageFade";
import { RailPage } from "./RailFrame";
import { Skeleton } from "./Skeleton";
import { Table } from "./Table";
import { Tabs } from "./Tabs";

import type { Copy } from "@/core/copy";
import type { ComponentProps, ReactNode } from "react";
import type { CardActRowProps } from "./Card";
import type { DialogAct } from "./dialogAct";
import type { EmptyStateProps } from "./EmptyState";
import type { Filter } from "./Filters";
import type { ListMore, ListSearch } from "./ListTable";
import type { RailPageHead } from "./RailFrame";
import type { SkeletonShape } from "./Skeleton";
import type { SpielRowProps } from "./SpielRow";
import type { TableProps } from "./Table";
import type { SchoolTile } from "./TileGrid";

/** The matchday tabs, each with its matches, and the tab the server chose by `chosenTab`. */
type SpieltagTabs = {
  label: Copy;
  selectedKey: string;
  tabs: ReadonlyArray<{ id: string; label: Copy; panel: ReactNode }>;
};

/** A table's rows, and how a list past one read's cap reaches the rest. */
type TableContent = { table: TableProps; more?: ListMore };

/** The season's matches once read: the matchday tabs, or why there are none. */
export type SpieltageContent = {
  /** The matchday tabs; `null` while the season has no matchday yet. */
  tabs: SpieltagTabs | null;
  /** Why there is no matchday to show, standing in the tabs' place. */
  empty: EmptyStateProps;
};

/** One card per group under the page's one title, such as the Tabelle's: each group's name and count heading its table. */
type GroupsContent = {
  groups: ReadonlyArray<{ id: string; title: Copy; table: TableProps }>;
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
      content: Promise<TableContent>;
    }
  | { kind: "spieltage"; content: Promise<SpieltageContent> }
  | { kind: "groups"; content: Promise<GroupsContent> }
  | { kind: "cards"; content: Promise<CardsContent> }
  | { kind: "tree"; content: Promise<TreeContent> }
  | { kind: "spiele"; /** The search field's name. */ search: ListSearch; content: Promise<SpieleContent> }
  | { kind: "tiles"; /** The search field's name. */ search: ListSearch; content: Promise<TilesContent> };

/** The skeleton each kind waits in: rows, a matchday's match cards, the tree's cards, a list of matches, the tiles. */
const WAIT: Readonly<Record<ListContent["kind"], SkeletonShape>> = {
  table: "table",
  groups: "table",
  cards: "cardRows",
  spieltage: "cards",
  tree: "cards",
  spiele: "cards",
  tiles: "tiles",
};

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
 * The filter block's place while its choices are read, at the height it will stand at, so nothing under the
 * toolbar moves when it arrives, as every part of a template's frame holds its space: on a phone the „Filter“ button's line,
 * on desktop a labelled select, its label, its field and the line under it.
 */
function FiltersSpace() {
  return (
    <div
      aria-hidden
      className="h-8 lg:h-19 pointer-coarse:h-10 lg:pointer-coarse:h-21"
    />
  );
}

/** The filter block once its choices are read. */
async function FiltersOnceRead({ filters }: { filters: Promise<ReadonlyArray<Filter>> }) {
  return <Filters filters={await filters} />;
}

/** The list once its content is read, in the boundary's place. */
async function ListBody({ list }: { list: ListContent }) {
  switch (list.kind) {
    case "table": {
      const { table, more } = await list.content;
      return (
        <ListTable
          table={table}
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
 * boundary, drawn meanwhile as the skeleton of its box. Typing into the search field before the rows arrive
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
  /** A record created where its list shows: the dialog's title, its act, its fields and the action. */
  create?: DialogAct;
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
          <div className="flex flex-wrap items-center gap-3">
            {search !== undefined && <ListSearchField label={search.label} />}
            {filters !== undefined && (
              <Suspense fallback={<FiltersSpace />}>
                <FiltersOnceRead filters={filters} />
              </Suspense>
            )}
            {create !== undefined && (
              <div className="ms-auto">
                <Dialog
                  {...create}
                  trigger={
                    <Button
                      variant="primary"
                      leadingIcon="create"
                      label={actLabel(create.act)}
                    />
                  }
                />
              </div>
            )}
          </div>
        )}
        <PageWait fallback={<Skeleton shape={WAIT[list.kind]} />}>
          <ListBody list={list} />
        </PageWait>
      </ListQueryScope>
    </RailPage>
  );
}
