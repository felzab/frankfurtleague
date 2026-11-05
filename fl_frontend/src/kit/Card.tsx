import { textOf } from "@/core/copy";

import { card, cardHover, stacked } from "./cardStyles";
import { Chip } from "./Chip";
import { Link } from "./Link";
import { RowEnd } from "./RowEnd";
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
      /** Where what the card stands for is, such as a season's state, right after its title. */
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
        {chip === undefined ? (
          <h2 className={s.title()}>{textOf(title)}</h2>
        ) : (
          // The chip right after the name it belongs to, as on every row and title carrying one.
          <span className={s.named()}>
            <h2 className={s.title()}>{textOf(title)}</h2>
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
 * One choice of the chooser: the whole card one link, its title and its line, the chevron at its right.
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

const actRow = tv({
  slots: {
    root: `relative grid min-h-14 gap-x-3 gap-y-2 ${stacked()} px-4 py-3 text-sm lg:min-h-13 ${cardHover()}`,
    words: "grid min-w-0 gap-0.5",
    name: "flex min-w-0 items-center gap-2",
    line: "text-xs text-fg-muted",
    // Positioned above the row's stretched link, so a press on an act does the act rather than open the record.
    acts: "relative z-10 flex items-center gap-2 lg:justify-self-end",
  },
  variants: {
    // With acts, one column on a phone, the acts under the words, and from `lg` the acts at the row's end; with
    // none, the chevron at the row's end at every width.
    acts: {
      true: { root: "lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center" },
      false: { root: "grid-cols-[minmax(0,1fr)_auto] items-center" },
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
 * what is open, and its acts, one or two kit buttons, under the words on a phone and at the row's end from
 * `lg`, so the name keeps the phone's whole width. The whole row opens the record through its name, as every
 * card row does; a row with no act ends in the chevron instead. A name too long for its line is cut with „…“, so
 * the chip keeps its place beside it; the full name stays the link's accessible name and shows as its title.
 */
export function CardActRow({ href, name, chip, line, acts }: CardActRowProps) {
  const s = actRow({ acts: acts !== undefined });
  return (
    <div className={s.root()}>
      <span className={s.words()}>
        <span className={s.name()}>
          <span
            title={textOf(name)}
            className="min-w-0 truncate font-medium">
            <Link
              href={href}
              placement="row"
              label={name}
            />
          </span>
          {chip !== undefined && <Chip {...chip} />}
        </span>
        <span className={s.line()}>{textOf(line)}</span>
      </span>
      {acts === undefined ? <RowEnd /> : <span className={s.acts()}>{acts}</span>}
    </div>
  );
}
