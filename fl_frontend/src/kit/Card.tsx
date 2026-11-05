import { textOf } from "@/core/copy";

import { card, cardHover, stacked } from "./cardStyles";
import { Chip } from "./Chip";
import { CutText } from "./CutText";
import { Link } from "./Link";
import { RowEnd } from "./RowEnd";
import { placeholderBar, PlaceholderLine } from "./Skeleton";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { Route } from "next";
import type { ReactElement, ReactNode } from "react";
import type { ChipProps } from "./Chip";

export type CardProps = {
  /** Catalogue text such as the kind of open work, or a record's own name, such as a club's. */
  title: Words;
  /** The card's one button. */
  action?: ReactElement;
  body?: "rows" | "fields";
  children?: ReactNode;
  /** The one line under the title: catalogue text such as a figure's meaning, or a record's own detail. */
  line?: Words;
} & (
  | {
      /** How many items the card holds open. */
      count?: number;
      chip?: never;
    }
  | {
      /** Where what the card stands for is, such as a season's state, at the head's end. */
      chip: ChipProps;
      count?: never;
    }
);

/**
 * One kind of open work, its count beside its title, its records as rows or its inputs as fields. A card whose
 * body folds behind its head is `CardFold`, a module of its own, so a page placing only plain cards ships none
 * of the fold's client code.
 */
export function Card({ title, count, chip, action, body = "rows", children, line }: CardProps) {
  const s = card({ body });
  return (
    <section className={s.root()}>
      <div className={s.head()}>
        <h2 className={s.title()}>{textOf(title)}</h2>
        {/* At the head's end, where a count stands, in the card's every state: the one exception to a chip standing
            right after its name, ruled for the landing's season card, whose state is the card's, not its title's. */}
        {chip !== undefined && (
          <span className={s.end()}>
            <Chip {...chip} />
          </span>
        )}
        {count !== undefined && <span className={s.count()}>{count}</span>}
        {line !== undefined && <span className={s.line()}>{textOf(line)}</span>}
      </div>
      {children !== undefined && <div className={s.body()}>{children}</div>}
      {action !== undefined && <div className={s.foot()}>{action}</div>}
    </section>
  );
}

/**
 * A card while its records are read: its own box and head, the title where the page knows it and a bar where the
 * record names it, a bar where the count will stand, and over its body the placeholders the page's rows draw, such
 * as a table's or `CardRowsPlaceholder`. `chip` keeps the chip's place at the head's end, where the card carries one.
 */
export function CardPlaceholder({
  title,
  count = false,
  chip = false,
  children,
}: {
  title?: Words;
  count?: boolean;
  chip?: boolean;
  children?: ReactNode;
}) {
  const s = card();
  const name =
    title === undefined ? (
      <PlaceholderLine
        text={s.title()}
        width="w-1/3"
      />
    ) : (
      <span className={s.title()}>{textOf(title)}</span>
    );
  return (
    <div className={s.root()}>
      <div className={s.head()}>
        {name}
        {chip && (
          <span className={s.end()}>
            <span className={placeholderBar("h-5 w-16")} />
          </span>
        )}
        {count && (
          <span className={s.count()}>
            <span className={placeholderBar("h-3 w-4")} />
          </span>
        )}
      </div>
      {children !== undefined && <div className={s.body()}>{children}</div>}
    </div>
  );
}

/**
 * A card's rows while they are read: `rows` of `CardActRow`'s rows at its height, each its name over its one line as
 * bars, the chevron at its end where a row leads on.
 */
export function CardRowsPlaceholder({ rows }: { rows: number }) {
  const s = actRow({ acts: false });
  return Array.from({ length: rows }, (_, index) => (
    <div
      key={index}
      className={s.root()}>
      <span className={s.words()}>
        <PlaceholderLine
          text="text-sm"
          width="w-1/2"
        />
        <PlaceholderLine
          text={s.line()}
          width="w-1/3"
        />
      </span>
      <span className={s.end()}>
        <RowEnd />
      </span>
    </div>
  ));
}

/**
 * One choice of the chooser: the whole card one link, its title and its line, the chevron at its right.
 * @awaitsPage the role chooser's page
 * @awaitsProduction the role chooser's page
 */
export function CardLink({ href, title, line }: { href: Route; title: Copy; line: Words }) {
  return (
    <section className={card().root()}>
      <Link
        href={href}
        placement="card">
        <span className="flex items-stretch gap-x-3 px-4 py-3">
          <span className="grid min-w-0 flex-1 gap-1">
            <span className="text-base font-semibold break-words">{title}</span>
            <span className="text-sm text-fg-muted">{textOf(line)}</span>
          </span>
          <RowEnd />
        </span>
      </Link>
    </section>
  );
}

// The chevron is the row's own end column at every width, right and centred on the row's height, 12 px after what
// stands before it: the words, or the acts.
const actRow = tv({
  slots: {
    root: `relative grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 ${stacked()} px-4 py-3 text-sm lg:min-h-13 ${cardHover()}`,
    words: "grid min-w-0 gap-0.5",
    name: "flex min-w-0 items-center gap-2",
    line: "text-xs text-fg-muted",
    // Positioned above the row's stretched link, so a press on an act does the act rather than open the record.
    acts: "relative z-10 col-start-1 row-start-2 flex items-center gap-2 lg:col-start-2 lg:row-start-1 lg:justify-self-end",
    end: "flex self-stretch",
  },
  variants: {
    // With acts, the acts under the words on a phone, the chevron beside both, and from `lg` the acts between the
    // words and the chevron, all on one line.
    acts: {
      true: { root: "lg:grid-cols-[minmax(0,1fr)_auto_auto]", end: "row-span-2 lg:row-span-1" },
      false: {},
    },
  },
});

/** One record in a card's rows: where it opens, its name with its chip, its one line, and its acts. */
export type CardActRowProps = {
  href: Route;
  name: Words;
  chip?: ChipProps;
  line: Words;
  /** The row's acts, such as „Übernehmen“ and „Verwerfen“; none where the open work is done in the record. */
  acts?: ReactElement;
};

/**
 * One record in a card's rows whose open work is done where it shows: its name with its chip, one line saying
 * what is open, and its acts, one or two kit buttons, under the words on a phone and before the chevron from
 * `lg`, so the name keeps the phone's whole width. The whole row opens the record through its name, as every
 * card row does, and ends in the chevron, with acts or none; under the pointer the row takes the one hover layer
 * and an act's own stacks on it. A name too long for its line is cut with „…“, so
 * the chip keeps its place beside it; the full name stays the link's accessible name and shows as its title while it is cut.
 */
export function CardActRow({ href, name, chip, line, acts }: CardActRowProps) {
  const s = actRow({ acts: acts !== undefined });
  return (
    <div className={s.root()}>
      <span className={s.words()}>
        <span className={s.name()}>
          <CutText
            text={textOf(name)}
            className="min-w-0 truncate font-medium">
            <Link
              href={href}
              placement="row"
              label={name}
            />
          </CutText>
          {chip !== undefined && <Chip {...chip} />}
        </span>
        <span className={s.line()}>{textOf(line)}</span>
      </span>
      {acts !== undefined && <span className={s.acts()}>{acts}</span>}
      <span className={s.end()}>
        <RowEnd />
      </span>
    </div>
  );
}
