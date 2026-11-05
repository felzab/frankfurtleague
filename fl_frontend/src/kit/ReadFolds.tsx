import { textOf } from "@/core/copy";

import { CardFold } from "./CardFold";
import { card as cardLook, stacked } from "./cardStyles";
import { GroupHead } from "./GroupHead";
import { placeholderBar, PlaceholderLine } from "./Skeleton";
import { Table } from "./Table";

import type { Copy, Words } from "@/core/copy";
import type { TableProps } from "./Table";

/**
 * One folded card: its title, catalogue text or a record's name such as a club's; how many it holds; and its
 * tables, one, or several each under its head, such as a line-up's starters over its bench.
 */
export type FoldedCard = {
  title: Words;
  count?: number;
  tables: readonly [TableProps] | ReadonlyArray<{ head: Copy; table: TableProps }>;
};

const folds = (count: number) => (count > 1 ? "grid content-start gap-3 lg:grid-cols-2" : "grid");

/**
 * The folded cards while they are read: `count` of `CardFold`'s heads, as the page first shows them, folded, each its
 * chevron, its title's line and its count as bars, set as `ReadFolds` sets them.
 */
export function ReadFoldsPlaceholder({ count }: { count: number }) {
  const s = cardLook({ body: "rows", fold: true });
  return (
    <div className={folds(count)}>
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className={s.root()}>
          <span className={s.head()}>
            <span className={s.title()}>
              <span className={placeholderBar("size-4", "head")} />
              <PlaceholderLine
                ground="head"
                text="text-base"
                width="w-32"
              />
            </span>
            <span className={s.count()}>
              <span className={placeholderBar("h-3 w-4", "head")} />
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * A read page's tables, each folded behind its card's head, two side by side from `lg`, such as a match's
 * line-ups: the content of `ReadPage`'s `folds` group. It is a module of its own, which only the pages folding
 * a card import, so a read page folding nothing ships none of the fold's client code.
 */
export function ReadFolds({ cards }: { cards: ReadonlyArray<FoldedCard> }) {
  return (
    <div className={folds(cards.length)}>
      {cards.map(({ tables, ...card }) => (
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
      ))}
    </div>
  );
}
