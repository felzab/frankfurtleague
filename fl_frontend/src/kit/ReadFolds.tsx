import { textOf } from "@/core/copy";

import { BlockBox } from "./BlockBox";
import { CardFold } from "./CardFold";
import { stacked } from "./cardStyles";
import { GroupHead } from "./GroupHead";
import { Table } from "./Table";

import type { Copy, Words } from "@/core/copy";
import type { ReactNode } from "react";
import type { TableProps } from "./Table";

/**
 * One folded card: its title, catalogue text or a record's name such as a club's; how many it holds; and its
 * tables, one, or several each under its head, such as a line-up's starters over its bench. `open` starts it open.
 */
export type FoldedCard = {
  title: Words;
  count?: number;
  open?: true;
  tables: readonly [TableProps] | ReadonlyArray<{ head: Copy; table: TableProps }>;
};

const SPLIT_FOLDS_CLASSES = "grid content-start items-start gap-6 @2xl:grid-cols-2";
const folds = (count: number) => (count > 1 ? SPLIT_FOLDS_CLASSES : "grid");

function FoldsBox({ count, children }: { count: number; children: ReactNode }) {
  return (
    <BlockBox>
      <div className={folds(count)}>{children}</div>
    </BlockBox>
  );
}

const COLUMN_CLASSES = "grid gap-6";

/**
 * Tables each folded behind its card's head, two side by side from 42 rem of their box, or, with `column`, one under
 * another. It is a module of its own, which only the pages folding a card import, so a page
 * folding nothing ships none of the fold's client code. Each card keeps its own height beside its neighbour, so one opening
 * leaves the other folded to its head rather than stretched to the row.
 */
export function ReadFolds({ cards, column = false }: { cards: ReadonlyArray<FoldedCard>; column?: boolean }) {
  const folded = cards.map(({ tables, ...card }) => (
    <CardFold
      key={textOf(card.title)}
      {...card}>
      {tables.map((part) =>
        "head" in part ? (
          <section
            key={part.head}
            className={stacked()}>
            <GroupHead text={part.head} />
            <Table
              {...part.table}
              bare
            />
          </section>
        ) : (
          <Table
            key={part.label}
            {...part}
            bare
          />
        ),
      )}
    </CardFold>
  ));
  return column ? <div className={COLUMN_CLASSES}>{folded}</div> : <FoldsBox count={cards.length}>{folded}</FoldsBox>;
}
