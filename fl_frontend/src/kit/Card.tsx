import { textOf } from "@/core/copy";
import { COPY } from "@/core/copy/shared";

import { Button } from "./Button";
import { actRow, card, cardHover, nameWithChips, stacked } from "./cardStyles";
import { Chip } from "./Chip";
import { CutText } from "./CutText";
import { HelpPopover } from "./HelpPopover";
import { Link } from "./Link";
import { RowEnd } from "./RowEnd";

import type { Copy, Words } from "@/core/copy";
import type { Route } from "next";
import type { ReactElement, ReactNode } from "react";
import type { ChipProps } from "./Chip";

export type CardProps = {
  /** Catalogue text such as the kind of open work, or a record's own name, such as a club's. */
  title: Words;
  body?: "rows" | "fields";
  children?: ReactNode;
  /** The one line under the title: catalogue text such as a figure's meaning, or a record's own detail. */
  line?: Words;
  /**
   * The card's help behind the ⓘ after its title, as a section's (`Section`): a few short declarative lines, one
   * statement each, such as what the marks of a group's standing mean.
   */
  help?: readonly [Copy, ...Copy[]];
  /**
   * The body takes the spare height of a card its grid stretches, such as the landing's decided season card beside the
   * hero, so the body's content can fill it rather than leave an empty card under it.
   */
  fill?: boolean;
} & (
  | {
      /** How many items the card holds open. */
      count?: number;
      chip?: never;
      /**
       * The page listing the card's records in full, where they have no page each, such as a team's registrations: the
       * title links it, its link stretched over the whole head, which ends in a row's chevron after the count.
       */
      href?: Route;
    }
  | {
      /** Where what the card stands for is, such as a season's state, at the head's end. */
      chip: ChipProps;
      count?: never;
      href?: never;
    }
);

/**
 * One kind of open work, its count beside its title, its records as rows or its inputs as fields. A card whose
 * body folds behind its head is `CardFold`, a module of its own, so a page placing only plain cards ships none
 * of the fold's client code.
 */
export function Card({ title, count, chip, href, body = "rows", children, line, help, fill = false }: CardProps) {
  const s = card({ body });
  const heading = (
    <h2 className={s.title()}>
      {href === undefined ? (
        textOf(title)
      ) : (
        <Link
          href={href}
          placement="row"
          label={title}
        />
      )}
    </h2>
  );
  return (
    // The body's `fr` row takes the spare height before the root's `content-start` packs anything; a card as tall as
    // its content has none, so `fill` changes nothing there.
    <section className={s.root({ class: fill ? "grid-rows-[auto_1fr]" : undefined })}>
      {/* A linked head is the box its link stretches over, and takes the hover layer a row that opens takes. */}
      <div className={s.head({ class: href === undefined ? undefined : `relative ${cardHover()}` })}>
        {help === undefined ? (
          heading
        ) : (
          // The ⓘ stands beside the heading, not in it, so the heading is named by its title alone, and reaches into the
          // head's padding rather than raising the head, as a section's does.
          <div className="flex items-center gap-2">
            {heading}
            <span className="-my-1 flex pointer-coarse:-my-2">
              <HelpPopover
                subject={title}
                lines={help}>
                <Button
                  icon="info"
                  label={COPY.shared.help}
                />
              </HelpPopover>
            </span>
          </div>
        )}
        {/* At the head's end, where a count stands, in the card's every state: the one exception to a chip standing
            right after its name, ruled for the landing's season card, whose state is the card's, not its title's. */}
        {chip !== undefined && (
          <span className={s.end()}>
            <Chip {...chip} />
          </span>
        )}
        {href === undefined ? (
          count !== undefined && <span className={s.count()}>{count}</span>
        ) : (
          // The count and the chevron share the head's end column, so a head without a count takes no gap for it; the
          // column stands as tall as the title's line, the chevron alone having no baseline to align by.
          <span className="col-start-2 row-start-1 flex items-center gap-3 self-stretch">
            {count !== undefined && <span className={s.count()}>{count}</span>}
            <RowEnd />
          </span>
        )}
        {line !== undefined && <span className={s.line()}>{textOf(line)}</span>}
      </div>
      {children !== undefined && <div className={s.body({ class: fill ? "grid" : undefined })}>{children}</div>}
    </section>
  );
}

/**
 * One choice of a chooser: its title, a record's own name such as a club's or the catalogue's for a place that is
 * no record's, the line under it where the choice has one to name, and where it leads.
 */
export type CardLinkProps = { href: Route; title: Words; line?: Words };

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

// A card's act row is the container its parts read (`actRow`): it spans its card, so its width is the
// card's and every row of one card takes one form.
const CARD_ROW_CLASSES = `@container relative ${stacked()} text-sm`;

export type CardActRowProps = {
  /**
   * The row's record; none where the record has no page of its own, as a registration's decision is taken on its
   * team's list, which the card's title links: the row then opens nothing, and draws no chevron and no hover.
   */
  href?: Route;
  name: Words;
  chip?: ChipProps;
  line?: Words;
  /** The row's acts, such as „Übernehmen“ and „Verwerfen“; none where the open work is done in the record. */
  acts?: ReactElement;
};

/**
 * One record in a card's rows whose open work is done where it shows, its acts one or two kit buttons: a decision, such
 * as „Zusagen“ and „Ablehnen“, or the row's one act, labelled at every width. The card's width picks where the acts
 * stand, for every row of the card alike: beside the words on a wide card, and on one line under them on a narrower
 * one, a phone's and each of two beside the rail.
 */
export function CardActRow({ href, name, chip, line, acts }: CardActRowProps) {
  const s = actRow({ opens: href !== undefined });
  const words = nameWithChips({ card: true });
  return (
    <div
      data-kit-row
      className={href === undefined ? CARD_ROW_CLASSES : `${CARD_ROW_CLASSES} ${cardHover()}`}>
      <span className={s.frame()}>
        <span className={s.words()}>
          <span className={words.line()}>
            <span className={words.head()}>
              <CutText
                text={textOf(name)}
                className={words.name()}>
                {/* With no link the cut text draws the name's words itself. */}
                {href === undefined ? undefined : (
                  <Link
                    href={href}
                    placement="row"
                    label={name}
                  />
                )}
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
        {acts !== undefined && <div className={s.acts()}>{acts}</div>}
        {href !== undefined && (
          <span className={s.end()}>
            <RowEnd />
          </span>
        )}
      </span>
    </div>
  );
}
