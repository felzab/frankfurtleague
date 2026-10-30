import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { actLabel } from "./dialogAct";
import { EmptyState } from "./EmptyState";
import { Filters } from "./Filters";
import { ListTable } from "./ListTable";
import { RailPage } from "./RailFrame";
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
 * The list template: the page's title in the strip; one toolbar row holding the search field where the list
 * is long enough to need one, the filter block, its values in the address, and at the row's end the act
 * creating a record over the list; then the list. The list is a table whose rows open their records,
 * „Weitere 50 laden“ under it only while the server reports more rows; or, for the season's matches, the
 * matchday tabs, one matchday at a time, opening on the one the server names. A list with nothing in it
 * shows its empty state in its place.
 */
export function ListPage({
  head,
  search,
  filters,
  create,
  list,
}: {
  head: RailPageHead;
  /** The search field's name, where the list holds about 20 rows or more. */
  search?: ListSearch;
  filters?: ReadonlyArray<Filter>;
  /** A record created where its list shows: the dialog's title, its act, its fields and the action. */
  create?: DialogAct;
  list:
    | { kind: "table"; table: TableProps; more?: ListMore }
    | {
        kind: "spieltage";
        /** The matchday tabs; `null` while the season has no matchday yet. */
        tabs: SpieltagTabs | null;
        /** Why there is no matchday to show, standing in the tabs' place. */
        empty: EmptyStateProps;
      };
}) {
  // The filters and the create act, which stands at the toolbar's end.
  const toolbar =
    filters === undefined && create === undefined ? undefined : (
      <>
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
      </>
    );

  return (
    <RailPage
      scope={head.scope}
      title={head.title}
      chip={head.chip}>
      {list.kind === "table" ? (
        <ListTable
          table={list.table}
          search={search}
          toolbar={toolbar}
          more={list.more}
        />
      ) : (
        <>
          {toolbar !== undefined && <div className="flex flex-wrap items-center gap-3">{toolbar}</div>}
          {list.tabs === null ? (
            // Inside the list's box, as `Table` places its own.
            <div className="overflow-hidden rounded-lg border border-border bg-bg">
              <EmptyState {...list.empty} />
            </div>
          ) : (
            <Spieltage {...list.tabs} />
          )}
        </>
      )}
    </RailPage>
  );
}
