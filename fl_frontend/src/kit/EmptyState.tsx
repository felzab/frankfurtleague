import { COPY } from "@/core/copy";

import type { Copy } from "@/core/copy";
import type { ReactElement } from "react";

/**
 * Why a list is empty, by what emptied it: a search, the filters, or nothing there yet. A page that
 * lacks something else names it in a sentence of its own from the catalogue.
 */
export type EmptyStateProps = (
  | { kind: "suche" | "filter" | "noch"; /** The list's own plural, „Spielorte“. */ plural: Copy; sentence?: never }
  | { kind: "satz"; sentence: Copy; plural?: never }
) & {
  /** The one act that fills the list, a kit `Button`, at the row's end. */
  action?: ReactElement;
};

function sentenceOf(props: EmptyStateProps) {
  if (props.kind === "satz") return props.sentence;
  return COPY.shared.leer[props.kind](props.plural);
}

/**
 * Nothing to show yet: one sentence in the list's place, one row high, its one button at the row's end;
 * on a phone the button goes under the sentence.
 */
export function EmptyState(props: EmptyStateProps) {
  return (
    <div className="grid min-h-14 grid-cols-1 items-center gap-2 px-4 py-3 text-base text-fg-muted lg:min-h-13 lg:grid-cols-[minmax(0,1fr)_auto] lg:py-0 lg:text-sm">
      <p>{sentenceOf(props)}</p>
      {props.action !== undefined && <div className="justify-self-start lg:justify-self-end">{props.action}</div>}
    </div>
  );
}
