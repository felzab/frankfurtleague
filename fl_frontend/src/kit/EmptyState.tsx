import { COPY } from "@/core/copy";

import { Icon } from "./Icon";

import type { Copy } from "@/core/copy";
import type { ReactElement } from "react";
import type { IconName } from "./Icon";

/**
 * An empty list's cause, apart from its wording: `kind` says what emptied it, a search, the filters, or
 * nothing there yet, and the catalogue words each cause with the list's own plural, so a search can empty
 * any list and still be said.
 */
export type EmptyStateProps = {
  kind: "suche" | "filter" | "noch";
  /** The list's own plural, „Spielorte“, from its title's key. */
  plural: Copy;
  /** The one act that fills the list, a kit `Button`. */
  action?: ReactElement;
  /** The mark over a list with nothing in it yet: the list's own rail mark, ⓘ where it names none. */
  glyph?: IconName;
};

/**
 * The empty state, standing inside the list's box, which its caller draws. A list with nothing in it yet
 * shows the blank slate: its muted mark over the sentence over the one button, centred. A list a search or
 * the filters emptied keeps one row, the sentence with its button at the row's end, under the sentence on a
 * phone.
 */
export function EmptyState(props: EmptyStateProps) {
  const sentence = COPY.shared.leer[props.kind](props.plural);
  if (props.kind === "noch") {
    return (
      <div className="grid justify-items-center gap-3 px-4 py-8 text-center">
        <span className="text-fg-muted">
          <Icon
            glyph={props.glyph ?? "info"}
            size={18}
          />
        </span>
        <p className="text-base text-fg-muted">{sentence}</p>
        {props.action !== undefined && <div>{props.action}</div>}
      </div>
    );
  }
  return (
    <div className="grid min-h-14 grid-cols-1 items-center gap-2 px-4 py-3 text-base text-fg-muted lg:min-h-13 lg:grid-cols-[minmax(0,1fr)_auto] lg:py-0 lg:text-sm">
      <p>{sentence}</p>
      {props.action !== undefined && <div className="justify-self-start lg:justify-self-end">{props.action}</div>}
    </div>
  );
}
