import { Facts } from "./Facts";
import { MatchList } from "./MatchRow";
import { formColumn, RailPage } from "./RailFrame";
import { SectionTitle } from "./Section";
import { Table } from "./Table";

import type { Copy } from "@/core/copy";
import type { ReactElement } from "react";
import type { Fact } from "./Facts";
import type { MatchRowProps } from "./MatchRow";
import type { RailPageHead } from "./RailFrame";
import type { TableProps } from "./Table";

type GroupContent =
  | { kind: "facts"; facts: ReadonlyArray<Fact> }
  | { kind: "table"; table: TableProps }
  | { kind: "matches"; matches: ReadonlyArray<MatchRowProps & { id: string }> };

/** One group of a read page, under its 16-px title: facts, people as table rows, or matches. */
export type ReadGroup = { title: Copy } & GroupContent;

function GroupBody({ group }: { group: GroupContent }) {
  switch (group.kind) {
    case "facts":
      return <Facts facts={group.facts} />;
    case "table":
      return <Table {...group.table} />;
    case "matches":
      return <MatchList matches={group.matches} />;
  }
}

/**
 * The read page: a record shown without editing, its groups one under another in the editor's column,
 * at most 760 px centred in the content (`formColumn`), no save bar. The first group holds the facts its decision reads, and the decision's acts stand
 * directly under it, together, with the line saying why an act is closed where one is; the next groups
 * follow the reader's next question.
 */
export function ReadPage({
  head,
  groups,
  acts,
  actsNote,
}: {
  head: RailPageHead;
  /** The first group goes without a title where it is the page's only one: the page's own title names it. */
  groups: readonly [{ title?: Copy } & GroupContent, ...ReadGroup[]];
  /** The decision's acts, the kit's buttons and the dialogs they open, under the first group. */
  acts?: ReadonlyArray<ReactElement>;
  /** Why an act is closed on the record's present state, under the acts. */
  actsNote?: Copy;
}) {
  const [first, ...rest] = groups;
  return (
    <RailPage
      area={head.area}
      title={head.title}
      chip={head.chip}>
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
