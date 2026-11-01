import { Suspense } from "react";

import { Facts } from "./Facts";
import { formColumn, RailPage } from "./RailFrame";
import { SectionTitle } from "./Section";
import { Skeleton } from "./Skeleton";
import { SpielList } from "./SpielRow";
import { Table } from "./Table";

import type { Copy } from "@/core/copy";
import type { ReactElement } from "react";
import type { ChipProps } from "./Chip";
import type { Fact } from "./Facts";
import type { PageTitle } from "./RailFrame";
import type { SpielRowProps } from "./SpielRow";
import type { TableProps } from "./Table";

type GroupContent =
  | { kind: "facts"; facts: ReadonlyArray<Fact> }
  | { kind: "table"; table: TableProps }
  | { kind: "matches"; matches: ReadonlyArray<SpielRowProps & { id: string }> };

/** One group of a read page, under its 16-px title: facts, people as table rows, or matches. */
type ReadGroup = { title: Copy } & GroupContent;

/** A record as its read page shows it, once it is read. */
export type ReadRecord = {
  /** The record names the page, so its title waits with the rest. */
  title: PageTitle;
  chip?: ChipProps;
  /** The first group goes without a title where it is the page's only one: the page's own title names it. */
  groups: readonly [{ title?: Copy } & GroupContent, ...ReadGroup[]];
  /** The decision's acts, the kit's buttons and the dialogs they open, under the first group. */
  acts?: ReadonlyArray<ReactElement>;
  /** Why an act is closed on the record's present state, under the acts. */
  actsNote?: Copy;
};

function GroupBody({ group }: { group: GroupContent }) {
  switch (group.kind) {
    case "facts":
      return <Facts facts={group.facts} />;
    case "table":
      return <Table {...group.table} />;
    case "matches":
      return <SpielList matches={group.matches} />;
  }
}

/** The page once its record is read, in the boundary's place. */
async function ReadBody({ scope, record }: { scope: "saison" | "area"; record: Promise<ReadRecord> }) {
  const { title, chip, groups, acts, actsNote } = await record;
  const [first, ...rest] = groups;
  return (
    <RailPage
      scope={scope}
      title={title}
      chip={chip}>
      <div className={formColumn()}>
        <section className="grid gap-3">
          {first.title !== undefined && <SectionTitle text={first.title} />}
          <GroupBody group={first} />
          {acts !== undefined && acts.length > 0 && (
            <div className="grid gap-3 lg:flex lg:flex-wrap lg:items-center">
              {acts}
              {actsNote !== undefined && <p className="text-sm text-warn lg:basis-full">{actsNote}</p>}
            </div>
          )}
        </section>
        {rest.map((group) => (
          <section
            key={group.title}
            className="grid gap-3">
            <SectionTitle text={group.title} />
            <GroupBody group={group} />
          </section>
        ))}
      </div>
    </RailPage>
  );
}

/**
 * The read page: a record shown without editing, its groups one under another in the editor's column,
 * at most 760 px centred in the content (`formColumn`), no save bar. The first group holds the facts its decision reads, and the decision's acts stand
 * directly under it, together, with the line saying why an act is closed where one is; the next groups
 * follow the reader's next question.
 *
 * The record names the page, so the whole page waits for it in the template's one boundary: meanwhile the
 * strip holds a bar where the title will stand and the column the skeleton of the facts.
 */
export function ReadPage({ scope, record }: { scope: "saison" | "area"; record: Promise<ReadRecord> }) {
  return (
    <Suspense
      fallback={
        <RailPage
          scope={scope}
          title={null}>
          <div className={formColumn()}>
            <Skeleton shape="facts" />
          </div>
        </RailPage>
      }>
      <ReadBody
        scope={scope}
        record={record}
      />
    </Suspense>
  );
}
