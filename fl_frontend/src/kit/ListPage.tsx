import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { EmptyState } from "./EmptyState";
import { Filters } from "./Filters";
import { ListTable } from "./ListTable";
import { RailPage } from "./RailFrame";
import { Tabs } from "./Tabs";

import type { Copy } from "@/core/copy";
import type { ComponentProps, ReactNode } from "react";
import type { EmptyStateProps } from "./EmptyState";
import type { Filter } from "./Filters";
import type { ListMore } from "./ListTable";
import type { RailPageHead } from "./RailFrame";
import type { TableProps } from "./Table";

/** A record created where its list shows: the dialog's title, its act, its fields and the action. */
export type ListCreate = Omit<ComponentProps<typeof Dialog>, "trigger">;

/** The matchday tabs, each with its matches, and the tab the server chose by `chosenTab`. */
type MatchdayTabs = {
  label: Copy;
  selectedKey: string;
  tabs: ReadonlyArray<{ id: string; label: string; panel: ReactNode }>;
};

/** The tab row, and under it the chosen matchday's matches alone: only the labels cross to the client row. */
function Matchdays({ label, selectedKey, tabs }: MatchdayTabs) {
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
 * The list template: the page's title in the strip; the search field where the list is long enough to need
 * one; the filter block, its values in the address, with the act creating a record over the list beside
 * it; then the list. The list is a table whose rows open their records, „Weitere 50 laden“ under it only
 * while the server reports more rows; or, for the season's matches, the matchday tabs, one matchday at a
 * time, opening on the one the server names. A list with nothing in it shows its empty state in its place.
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
  search?: { label: Copy };
  filters?: ReadonlyArray<Filter>;
  create?: ListCreate;
  list:
    | { kind: "table"; table: TableProps; more?: ListMore }
    | {
        kind: "spieltage";
        /** The matchday tabs; `null` while the season has no matchday yet. */
        tabs: MatchdayTabs | null;
        /** Why there is no matchday to show, standing in the tabs' place. */
        empty: EmptyStateProps;
      };
}) {
  const label =
    create === undefined
      ? undefined
      : create.act.objekt === undefined
        ? COPY.shared.verb[create.act.verb]
        : COPY.shared.mitObjekt(create.act.objekt, create.act.verb);

  const toolbar = (filters !== undefined || create !== undefined) && (
    <div className="flex flex-wrap items-start gap-3">
      {filters !== undefined && <Filters filters={filters} />}
      {create !== undefined && label !== undefined && (
        <Dialog
          {...create}
          trigger={
            <Button
              variant="primary"
              label={label}
            />
          }
        />
      )}
    </div>
  );

  return (
    <RailPage
      area={head.area}
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
          {toolbar}
          {list.tabs === null ? <EmptyState {...list.empty} /> : <Matchdays {...list.tabs} />}
        </>
      )}
    </RailPage>
  );
}
