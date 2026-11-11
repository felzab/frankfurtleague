import { COPY } from "@/core/copy";

import { cardSurface } from "./cardStyles";
import { Icon } from "./Icon";
import { Link } from "./Link";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { Route } from "next";
import type { ReactElement } from "react";
import type { IconName } from "./Icon";

/**
 * An empty list's cause, apart from its wording: `kind` says what emptied it, a search, the filters, or
 * nothing there yet, and the catalogue words each cause with the list's own plural, so a search can empty
 * any list and still be said.
 */
export type EmptyStateProps = {
  kind: "search" | "filter" | "none";
  /**
   * The list's own plural: its title's entry where its title is a plural, „Spielorte“, and otherwise the noun the
   * catalogue keeps for its rows, „Sperren“ under the title „Sperrliste“.
   */
  plural: Copy;
  /**
   * The list is one record named by a masculine or neuter noun rather than a plural, as a team's „Kader“, so
   * nothing there yet reads „Noch kein Kader.“; a feminine one, „Tabelle“, reads as a plural does.
   */
  one?: true;
  /**
   * The plural a search finding nothing names, where the list's own is not its rows': a team's „Kader“ is searched for
   * its „Spieler“, „Keine Spieler für diese Suche.“
   */
  searchPlural?: Copy;
  /**
   * A muted line under the sentence of a list with nothing in it yet, saying where its records come from: the
   * catalogue's words, or its words around one link, such as the league's address a team's registration link comes from.
   */
  line?: Copy | { before: Copy; link: { href: Route; label: Words }; after: Copy };
  /** The one act that fills the list, a kit `Button`. */
  action?: ReactElement;
  /** The mark over a list with nothing in it yet: the list's own rail mark, ⓘ where it names none. */
  glyph?: IconName;
};

/**
 * A list of open work with nothing waiting, such as an Übersicht card: „Nichts offen.“ No search or filter narrows
 * such a list, and no act fills it, so it names neither a plural nor a button.
 */
type Clear = { kind: "clear" };

/** The blank slate's parts. */
const slate = tv({
  slots: {
    root: "grid justify-items-center gap-3 px-4 py-8 text-center",
    mark: "text-fg-muted",
    sentence: "text-base text-fg-muted",
  },
});

/**
 * The empty state, standing inside the list's box, which its caller draws. A list with nothing in it yet
 * shows the blank slate: its muted mark over the sentence over the one button, centred. A list a search or
 * the filters emptied keeps one row, the sentence with its button at the row's end, under the sentence on a
 * phone, and so does a list of open work with nothing waiting, which has no act to offer.
 */
export function EmptyState(props: EmptyStateProps | Clear) {
  if (props.kind === "none") {
    const s = slate();
    return (
      <div className={s.root()}>
        <span className={s.mark()}>
          <Icon
            glyph={props.glyph ?? "info"}
            size={18}
          />
        </span>
        <p className={s.sentence()}>{props.one === true ? COPY.shared.empty.noneOne(props.plural) : COPY.shared.empty.none(props.plural)}</p>
        {props.line !== undefined && (
          <p className="text-sm text-fg-muted">
            {typeof props.line === "string" ? (
              props.line
            ) : (
              <>
                {props.line.before}
                <Link
                  href={props.line.link.href}
                  placement="text"
                  label={props.line.link.label}
                />
                {props.line.after}
              </>
            )}
          </p>
        )}
        {props.action !== undefined && <div>{props.action}</div>}
      </div>
    );
  }
  const { sentence, action } =
    props.kind === "clear"
      ? { sentence: COPY.shared.empty.nothingOpen, action: undefined }
      : props.kind === "search"
        ? { sentence: COPY.shared.empty.search(props.searchPlural ?? props.plural), action: props.action }
        : { sentence: COPY.shared.empty.filter(props.plural), action: props.action };
  return (
    <div className="grid min-h-14 grid-cols-1 items-center gap-2 px-4 py-3 text-base text-fg-muted lg:min-h-13 lg:grid-cols-[minmax(0,1fr)_auto] lg:py-0 lg:text-sm">
      <p>{sentence}</p>
      {action !== undefined && <div className="justify-self-start lg:justify-self-end">{action}</div>}
    </div>
  );
}

/**
 * The empty state in the list's own box, where nothing else draws the box: a list of cards, matches or tiles, a group or
 * a season holding none, or a list card a search emptied, whose place the box takes as `Table`'s box stays when its rows
 * go. Every page's empty list so stands in its list's box, or its section's where an editor section holds the list, whoever
 * reads it.
 */
export function EmptyBox(props: EmptyStateProps) {
  return (
    <div className={cardSurface({ class: "overflow-hidden" })}>
      <EmptyState {...props} />
    </div>
  );
}
