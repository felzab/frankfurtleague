import { textOf } from "@/core/copy";

import { CardFold } from "./CardFold";
import { card as cardLook, stacked } from "./cardStyles";
import { GroupHead } from "./GroupHead";
import { Icon } from "./Icon";
import { placeholderBar, PlaceholderLine } from "./Skeleton";
import { Table, TablePlaceholder } from "./Table";

import type { Copy, Words } from "@/core/copy";
import type { ReactNode } from "react";
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

/** Two cards to a row from 42 rem of the box they stand in, where there are several. */
const SPLIT_FOLDS_CLASSES = "grid content-start items-start gap-3 @2xl:grid-cols-2";
const folds = (count: number) => (count > 1 ? SPLIT_FOLDS_CLASSES : "grid");

/**
 * The container the folds' columns read, since a query reads an ancestor; `w-full`, since a container's width counts
 * none of its content.
 */
function FoldsBox({ count, children }: { count: number; children: ReactNode }) {
  return (
    <div className="@container w-full">
      <div className={folds(count)}>{children}</div>
    </div>
  );
}

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
    <FoldsBox count={count}>
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
    </FoldsBox>
  );
}

/** A fold's head while it is read: its chevron, turned where the card opens, its title, and a bar where its count stands. */
function FoldHeadPlaceholder({ title, open }: { title: Copy; open: boolean }) {
  const s = cardLook({ body: "rows", fold: true });
  return (
    <span className={s.head()}>
      <span className={s.title()}>
        <span className={s.chevron({ class: open ? "rotate-90" : "" })}>
          <Icon
            glyph="forward"
            size={16}
          />
        </span>
        <span className="min-w-0">{title}</span>
      </span>
      <FoldCountPlaceholder className={s.count()} />
    </span>
  );
}

/**
 * The open card of `ReadFolds`' `column` while it is read: its head and its table's placeholder; and with `folded`, the
 * cards folded under it, each its head alone, in the column `ReadFolds` sets them in.
 */
export function OpenFoldPlaceholder({
  title,
  head,
  rows,
  folded,
}: {
  title: Copy;
  head: TableHead;
  rows: number;
  folded?: ReadonlyArray<Copy>;
}) {
  const s = cardLook({ body: "rows", fold: true });
  const open = (
    <div className={s.root()}>
      <FoldHeadPlaceholder
        title={title}
        open
      />
      <div className={s.body()}>
        <TablePlaceholder
          head={head}
          rows={rows}
          bare
        />
      </div>
    </div>
  );
  if (folded === undefined) return open;
  return (
    <div className={COLUMN_CLASSES}>
      {open}
      {folded.map((card) => (
        <div
          key={card}
          className={s.root()}>
          <FoldHeadPlaceholder
            title={card}
            open={false}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Tables each folded behind its card's head, two side by side from 42 rem of their box, such as a match's line-ups:
 * the content of `ReadPage`'s `folds` group; or, with `column`, one under another, as the list template's `folds` kind
 * holds Administratoren's cards. It is a module of its own, which only the pages folding a card import, so a page
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
