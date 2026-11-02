import { COPY } from "@/core/copy";

import { cardSurface } from "./cardStyles";
import { tv } from "./tv";

/**
 * The final boxes a template waits for: a table's rows, a match list's, the match cards a Spielplan sets two a
 * row, a read page's facts, an editor's sections.
 */
export type SkeletonShape = "table" | "spiel" | "cards" | "facts" | "sections";

/** How many rows or boxes each shape draws. */
const ROWS: Readonly<Record<SkeletonShape, number>> = { table: 8, spiel: 6, cards: 6, facts: 4, sections: 2 };

/**
 * Each shape's bars, by their widths, where the final row's columns will stand: a table's rank, its name and
 * three figures at the row's end; a match row's date, home side, score and away side, the date and the away
 * side's bar left out on a phone, whose two-line card stacks them; a match card's date line over its two
 * sides; a fact's label over its value; a section's title.
 */
const BARS: Readonly<Record<SkeletonShape, readonly string[]>> = {
  table: ["w-6", "w-1/3", "ms-auto w-6", "w-6", "w-6"],
  spiel: ["w-20 max-lg:hidden", "w-1/3", "w-8", "w-1/3 max-lg:hidden"],
  cards: ["h-3 w-1/4", "w-1/2", "w-1/2"],
  facts: ["h-3 w-1/4", "w-1/2"],
  sections: ["w-1/2"],
};

const skeleton = tv({
  slots: {
    // Drawn invisible and shown once the wait passes `--loading-delay`, Next's way of keeping a fast load from
    // flashing a placeholder. The longhands, never the `animation` shorthand: under reduced motion
    // `--motion-in` is unset, which would invalidate the whole shorthand and leave the box invisible, where it
    // invalidates the duration alone, which falls back to 0s, so the box appears at once.
    root: "opacity-0 [animation-delay:var(--loading-delay)] [animation-duration:var(--motion-in)] [animation-fill-mode:forwards] [animation-name:kit-appear]",
    // A box of rows, as the list, the table or the facts that will stand in its place.
    box: `overflow-hidden ${cardSurface()}`,
    row: "flex items-center gap-3 border-t border-border px-4 first:border-t-0",
    // The base fill, with a lighter band sweeping across it every two seconds, under reduced motion too: a
    // loading indicator that stops reads as stuck.
    bar: "relative h-4 overflow-hidden rounded-md bg-bg-muted after:absolute after:inset-0 after:animate-[kit-shimmer_2s_linear_infinite] after:bg-linear-to-r after:from-transparent after:via-[rgb(255_255_255/0.55)] after:to-transparent dark:after:via-[rgb(255_255_255/0.09)]",
  },
  variants: {
    // Each shape's rows at the final box's height: a table's row; a match row, one line on desktop and two on
    // a phone; a fact, its label over its value; an editor's section, its title over its fields.
    shape: {
      table: { row: "h-14 lg:h-13" },
      spiel: { row: "h-24 lg:h-14" },
      cards: { row: `h-24 flex-col items-start justify-center gap-2 ${cardSurface()} first:border-t` },
      // A fact's label stands over its value, the label's bar shorter and lower.
      facts: { row: "h-14 flex-col items-start justify-center gap-2" },
      sections: { row: `h-40 ${cardSurface()} first:border-t` },
    },
  },
});

/**
 * A record's title while the record is read: one bar where the title will stand, appearing with the
 * content's skeleton. It belongs to that skeleton's wait, so it says nothing itself.
 */
export function SkeletonTitle() {
  const { root, bar } = skeleton();
  return (
    <span
      aria-hidden
      className={root({ class: "flex w-48 items-center" })}>
      <span className={bar({ class: "w-full" })} />
    </span>
  );
}

/**
 * Waiting for a template's content: the shape of the box that will stand in its place, its rows as
 * shimmering bars, shown only once the wait outlasts `--loading-delay` (`tokens.css`). Its status says
 * „Lädt“ in its subtree, which a live region announces where its name alone is not, and the box standing in
 * the content's place is busy. A template places it as its one boundary's fallback.
 */
export function Skeleton({ shape }: { shape: SkeletonShape }) {
  const { root, box, row, bar } = skeleton({ shape });
  const rows = Array.from({ length: ROWS[shape] }, (_, index) => (
    <div
      key={index}
      className={row()}>
      {BARS[shape].map((width, at) => (
        <span
          key={at}
          className={bar({ class: width })}
        />
      ))}
    </div>
  ));
  return (
    <div
      aria-busy
      className={root()}>
      <span
        role="status"
        className="sr-only">
        {COPY.shared.loading}
      </span>
      <div
        aria-hidden
        className={shape === "sections" ? "grid gap-6" : shape === "cards" ? "grid gap-3 lg:grid-cols-2" : box()}>
        {rows}
      </div>
    </div>
  );
}
