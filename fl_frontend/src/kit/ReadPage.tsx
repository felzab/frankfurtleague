import { Facts } from "./Facts";
import { MatchRow } from "./MatchRow";
import { RailPage } from "./RailFrame";
import { Table } from "./Table";

import type { Copy } from "@/core/copy";
import type { ComponentProps, ReactElement } from "react";
import type { Fact } from "./Facts";
import type { RailPageHead } from "./RailFrame";
import type { TableProps } from "./Table";

/** One group of a read page, under its 16-px title: facts, people as table rows, or matches. */
export type ReadGroup = { title: Copy } & (
  | { kind: "facts"; facts: ReadonlyArray<Fact> }
  | { kind: "table"; table: TableProps }
  | { kind: "matches"; matches: ReadonlyArray<ComponentProps<typeof MatchRow> & { id: string }> }
);

function GroupBody({ group }: { group: ReadGroup }) {
  switch (group.kind) {
    case "facts":
      return <Facts facts={group.facts} />;
    case "table":
      return <Table {...group.table} />;
    case "matches":
      return (
        <div className="overflow-hidden rounded-lg border border-border bg-bg">
          {group.matches.map(({ id, ...match }) => (
            <MatchRow
              key={id}
              {...match}
            />
          ))}
        </div>
      );
  }
}

/**
 * The read page: a record shown without editing, in the editor's column of at most 760 px, one group under
 * another, no save bar. The first group holds the facts its decision reads, and the decision's acts stand
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
  groups: readonly [ReadGroup, ...ReadGroup[]];
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
      <div className="grid w-full max-w-[47.5rem] gap-6">
        <section className="grid gap-3">
          <h2 className="text-base font-semibold">{first.title}</h2>
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
            <h2 className="text-base font-semibold">{group.title}</h2>
            <GroupBody group={group} />
          </section>
        ))}
      </div>
    </RailPage>
  );
}
