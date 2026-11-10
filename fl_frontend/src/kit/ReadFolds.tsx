import { textOf } from "@/core/copy";

import { CardFold } from "./CardFold";
import { card as cardLook, stacked } from "./cardStyles";
import { GroupHead } from "./GroupHead";
import { Icon } from "./Icon";
import { placeholderBar, PlaceholderLine } from "./Skeleton";
import { Table, TablePlaceholder } from "./Table";

import type { Copy, Words } from "@/core/copy";
import type { TableHead, TableProps } from "./Table";

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

/** Two cards to a row from `lg`, where there are several. */
const SPLIT_FOLDS_CLASSES = "grid content-start items-start gap-3 lg:grid-cols-2";
const folds = (count: number) => (count > 1 ? SPLIT_FOLDS_CLASSES : "grid");

/** One card under another at every width, as the list template sets its cards. */
const COLUMN_CLASSES = "grid gap-6";

/**
 * A fold head's count while it is read. The bar stands inline, so its line keeps the count's strut and with it a
 * baseline: the head's row aligns on baselines, which stands the count's line 1 px past the title's, and a block bar,
 * holding none, leaves the head 1 px short.
 */
const FoldCountPlaceholder = ({ className }: { className: string }) => (
  <span className={className}>
    <span className={placeholderBar("inline-block h-3 w-4 align-middle")} />
  </span>
);

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
              <span className={placeholderBar("size-4")} />
              <PlaceholderLine
                textClass="text-base"
                widthClass="w-32"
              />
            </span>
            <FoldCountPlaceholder className={s.count()} />
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The open card of `ReadFolds`' `column` while it is read: its title, its chevron turned as an open card's, a bar where
 * its count stands, and its table's placeholder.
 */
export function OpenFoldPlaceholder({ title, head, rows }: { title: Copy; head: TableHead; rows: number }) {
  const s = cardLook({ body: "rows", fold: true });
  return (
    <div className={s.root()}>
      <span className={s.head()}>
        <span className={s.title()}>
          <span className={s.chevron({ class: "rotate-90" })}>
            <Icon
              glyph="forward"
              size={16}
            />
          </span>
          <span className="min-w-0">{title}</span>
        </span>
        <FoldCountPlaceholder className={s.count()} />
      </span>
      <div className={s.body()}>
        <TablePlaceholder
          head={head}
          rows={rows}
          bare
        />
      </div>
    </div>
  );
}

/**
 * Tables each folded behind its card's head, two side by side from `lg`, such as a match's line-ups: the content of
 * `ReadPage`'s `folds` group; or, with `column`, one under another, as the list template's `folds` kind holds
 * Administratoren's cards. It is a module of its own, which only the pages folding a card import, so a page folding
 * nothing ships none of the fold's client code. Each card keeps its own height beside its neighbour, so one opening
 * leaves the other folded to its head rather than stretched to the row.
 */
export function ReadFolds({ cards, column = false }: { cards: ReadonlyArray<FoldedCard>; column?: boolean }) {
  return (
    <div className={column ? COLUMN_CLASSES : folds(cards.length)}>
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
