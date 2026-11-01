import { Suspense } from "react";

import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { actLabel } from "./dialogAct";
import { EmptyState } from "./EmptyState";
import { Filters } from "./Filters";
import { ListQueryScope, ListSearchField, ListTable } from "./ListTable";
import { RailPage } from "./RailFrame";
import { Skeleton } from "./Skeleton";
import { Tabs } from "./Tabs";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";
import type { DialogAct } from "./dialogAct";
import type { EmptyStateProps } from "./EmptyState";
import type { Filter } from "./Filters";
import type { ListMore, ListSearch } from "./ListTable";
import type { RailPageHead } from "./RailFrame";
import type { TableProps } from "./Table";

/** The matchday tabs, each with its matches, and the tab the server chose by `chosenTab`. */
type SpieltagTabs = {
  label: Copy;
  selectedKey: string;
  tabs: ReadonlyArray<{ id: string; label: string; panel: ReactNode }>;
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
  | { kind: "spieltage"; content: Promise<SpieltageContent> };

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

/** The list once its content is read, in the boundary's place. */
async function ListBody({ list }: { list: ListContent }) {
  if (list.kind === "table") {
    const { table, more } = await list.content;
    return (
      <ListTable
        table={table}
        more={more}
      />
    );
  }
  const { tabs, empty } = await list.content;
  return tabs === null ? (
    // Inside the list's box, as `Table` places its own.
    <div className="overflow-hidden rounded-lg border border-border bg-bg">
      <EmptyState {...empty} />
    </div>
  ) : (
    <Spieltage {...tabs} />
  );
}

/**
 * The list template: the page's title in the strip; one toolbar row holding the search field where the list
 * is long enough to need one, the filter block, its values in the address, and at the row's end the act
 * creating a record over the list; then the list. The list is a table whose rows open their records,
 * „Weitere 50 laden“ under it only while the server reports more rows; or, for the season's matches, the
 * matchday tabs, one matchday at a time, opening on the one the server names. A list with nothing in it
 * shows its empty state in its place.
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
  filters?: ReadonlyArray<Filter>;
  /** A record created where its list shows: the dialog's title, its act, its fields and the action. */
  create?: DialogAct;
  list: ListContent;
}) {
  const search = list.kind === "table" ? list.search : undefined;
  const hasToolbar = search !== undefined || filters !== undefined || create !== undefined;

  return (
    <RailPage {...head}>
      <ListQueryScope>
        {/* One toolbar row: the search at a reading width, the filters beside it, the create act at the row's
            end; on a phone the search keeps the width and the buttons share the next line. */}
        {hasToolbar && (
          <div className="flex flex-wrap items-center gap-3">
            {search !== undefined && <ListSearchField label={search.label} />}
            {filters !== undefined && <Filters filters={filters} />}
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
        <Suspense fallback={<Skeleton shape={list.kind === "table" ? "table" : "spiel"} />}>
          <ListBody list={list} />
        </Suspense>
      </ListQueryScope>
    </RailPage>
  );
}
