import { COPY } from "@/core/copy";

import { tv } from "./tv";

const skeleton = tv({
  slots: {
    // The list's card, so the placeholder stands where the rows will.
    root: "overflow-hidden rounded-lg border border-border bg-bg",
    row: "flex items-center border-t border-border px-4 first:border-t-0",
    // The base fill, with a lighter band sweeping across it every two seconds, the site's sweep today.
    bar: "relative h-4 w-1/2 overflow-hidden rounded-md bg-bg-muted after:absolute after:inset-0 after:animate-[kit-shimmer_2s_linear_infinite] after:bg-linear-to-r after:from-transparent after:via-[rgb(255_255_255/0.55)] after:to-transparent dark:after:via-[rgb(255_255_255/0.09)]",
  },
  variants: {
    // The final box's rows: a table's rows, or a match row, one line on desktop and two on a phone.
    shape: {
      table: { row: "h-14 lg:h-13" },
      spiel: { row: "h-24 lg:h-14" },
    },
  },
});

/**
 * Waiting, shown only where the measured wait exceeds one second: the shape of the list that will stand
 * in its place, its rows as shimmering bars.
 */
export function Skeleton({ shape, rows }: { shape: "table" | "spiel"; rows: number }) {
  const { root, row, bar } = skeleton({ shape });
  return (
    <div
      role="status"
      aria-label={COPY.shared.laedt}
      className={root()}>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden
          className={row()}>
          <span className={bar()} />
        </div>
      ))}
    </div>
  );
}
