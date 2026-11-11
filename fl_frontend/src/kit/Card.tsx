import { textOf } from "@/core/copy";

import { buttonPlaceholder } from "./buttonStyles";
import { actRow, card, cardHover, nameWithChips, stacked } from "./cardStyles";
import { Chip } from "./Chip";
import { CutText } from "./CutText";
import { Link } from "./Link";
import { RowActs } from "./RowActs";
import { RowEnd } from "./RowEnd";
import { placeholderBar, PlaceholderLine } from "./Skeleton";

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
 * as a table's or `CardRowsPlaceholder`. `chip` keeps the chip's place at the head's end, where the card carries one,
 * `line` the line under the title's, and `body` is the body's kind, as `Card`'s.
 */
export function CardPlaceholder({
  title,
  count = false,
  chip = false,
  line = false,
  body = "rows",
  children,
}: {
  title?: Words;
  count?: boolean;
  chip?: boolean;
  line?: boolean;
  body?: "rows" | "fields";
  children?: ReactNode;
}) {
  const s = card({ body });
  const name =
    title === undefined ? (
      <PlaceholderLine
        textClass={s.title()}
        widthClass="w-1/3"
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
        {line && (
          <PlaceholderLine
            textClass={s.line()}
            widthClass="w-1/4"
          />
        )}
      </div>
      {children !== undefined && <div className={s.body()}>{children}</div>}
    </div>
  );
}

/**
 * A card's rows while they are read: `rows` of `CardActRow`'s rows, drawn from its recipe inside its container, so each
 * takes the form the card's width gives the rows: its name over the line a row may add as bars, its `acts` as buttons'
 * placeholders by their labels where the card's rows carry acts, and the chevron at its end where a row leads on. A
 * row's chip stands on its name's line and adds nothing to its height, so the wait draws none.
 */
export function CardRowsPlaceholder({ rows, acts }: { rows: number; acts?: ReadonlyArray<Copy> }) {
  const s = actRow({ opens: true });
  return Array.from({ length: rows }, (_, index) => (
    <div
      key={index}
      className={CARD_ROW_CLASSES}>
      <span className={s.frame()}>
        <span className={s.words()}>
          <PlaceholderLine
            textClass="text-sm"
            widthClass="w-1/2"
          />
          <PlaceholderLine
            textClass={s.line()}
            widthClass="w-1/3"
          />
        </span>
        {acts !== undefined && (
          <span className={s.acts()}>
            {acts.map((label) => (
              <span
                key={label}
                className={buttonPlaceholder()}>
                {label}
              </span>
            ))}
          </span>
        )}
        <span className={s.end()}>
          <RowEnd />
        </span>
      </span>
    </div>
  ));
}

/**
 * One choice of a chooser: its title, a record's own name such as a club's or the catalogue's for a place that is
 * no record's, the line under it where the choice has one to name, and where it leads.
 */
export type CardLinkProps = { href: Route; title: Words; line?: Words };

/** One choice of the chooser: the whole card one link, its title and its line, the chevron at its right. */
export function CardLink({ href, title, line }: CardLinkProps) {
  return (
    <section className={card().root()}>
      <Link
        href={href}
        placement="card">
        <span className="flex items-stretch gap-x-3 px-4 py-3">
          <span className="grid min-w-0 flex-1 gap-1">
            <span className="text-base font-semibold break-words">{textOf(title)}</span>
            {line !== undefined && <span className="text-sm text-fg-muted">{textOf(line)}</span>}
          </span>
          <RowEnd />
        </span>
      </Link>
    </section>
  );
}

// A card's act row is the container its parts read (`cardStyles.ts :: actRow`): it spans its card, so its width is the
// card's and every row of one card takes one form.
const CARD_ROW_CLASSES = `@container relative ${stacked()} text-sm ${cardHover()}`;

/** One record in a card's rows: where it opens, its name with its chip, its line where it has one, and its acts. */
export type CardActRowProps = {
  href: Route;
  name: Words;
  chip?: ChipProps;
  line?: Words;
  /** The row's acts, such as „Übernehmen“ and „Verwerfen“; none where the open work is done in the record. */
  acts?: ReactElement;
};

/**
 * One record in a card's rows whose open work is done where it shows: its name with its chip, a line saying what is
 * open where the name and the chip leave something to say, and its acts, one or two kit buttons: a decision, such as
 * „Zusagen“ and „Ablehnen“, or the row's one act, labelled at every width. The chip stands directly after the name on
 * its line (`cardStyles.ts :: nameWithChips`). The card's width picks where the acts stand, for every row of the card
 * alike: on a card from 32 rem beside the words, before the chevron; on a narrower one, a phone's and each of two beside
 * the rail, on one line under the words. The whole row opens the record through its name, as every card row does, and
 * ends in the chevron, with acts or none; under the pointer the row takes the one hover layer and an act's own stacks
 * on it. A name too long for its line is cut with „…“; the full name stays the link's accessible name and shows as its
 * title while it is cut.
 */
export function CardActRow({ href, name, chip, line, acts }: CardActRowProps) {
  const s = actRow({ opens: true });
  const words = nameWithChips({ card: true });
  return (
    <div
      data-kit-row
      className={CARD_ROW_CLASSES}>
      <span className={s.frame()}>
        <span className={s.words()}>
          <span className={words.line()}>
            <span className={words.head()}>
              <CutText
                text={textOf(name)}
                className={words.name()}>
                <Link
                  href={href}
                  placement="row"
                  label={name}
                />
              </CutText>
            </span>
            {chip !== undefined && (
              <span className={words.chips()}>
                <Chip {...chip} />
              </span>
            )}
          </span>
          {line !== undefined && <span className={s.line()}>{textOf(line)}</span>}
        </span>
        {acts !== undefined && <RowActs className={s.acts()}>{acts}</RowActs>}
        <span className={s.end()}>
          <RowEnd />
        </span>
      </span>
    </div>
  );
}
