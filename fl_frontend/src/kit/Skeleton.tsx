import { COPY } from "@/core/copy";

import { card, cardSurface, stacked } from "./cardStyles";
import { tv } from "./tv";

/**
 * The final boxes a template waits for: a table's rows, the match cards a Spielplan sets two a row, a read page's
 * facts, an editor's sections, the school tiles Teams sets four a row.
 */
export type SkeletonShape = "table" | "cards" | "facts" | "sections" | "tiles";

/** How many rows or boxes each shape draws. */
const ROWS: Readonly<Record<SkeletonShape, number>> = { table: 8, cards: 6, facts: 4, sections: 2, tiles: 8 };

/**
 * The shapes whose rows are boxes of their own, laid out as their final boxes are: the sections one under another,
 * the match cards two a row from `lg`, the tiles four a row and two on a phone. Every other shape is one box of rows.
 */
const GRID: Partial<Record<SkeletonShape, string>> = {
  sections: "grid gap-6",
  cards: "grid gap-3 lg:grid-cols-2",
  tiles: "grid grid-cols-2 gap-2 lg:grid-cols-4",
};

/**
 * Each shape's bars, by their widths, where the final row's columns will stand: a table's rank, its name and
 * three figures at the row's end; a match card's date line over its two sides; a fact's label over its value; a section's title; a tile's plaque and its name.
 */
const BARS: Readonly<Record<SkeletonShape, readonly string[]>> = {
  table: ["w-6", "w-1/3", "ms-auto w-6", "w-6", "w-6"],
  cards: ["h-3 w-1/4", "w-1/2", "w-1/2"],
  facts: ["h-3 w-1/4", "w-1/2"],
  sections: ["w-1/2"],
  tiles: ["h-6 w-10", "w-1/2"],
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
    row: `flex items-center gap-3 ${stacked()} px-4`,
    // The base fill, with a lighter band sweeping across it every two seconds, under reduced motion too: a
    // loading indicator that stops reads as stuck.
    bar: "relative h-4 overflow-hidden rounded-md bg-bg-muted after:absolute after:inset-0 after:animate-[kit-shimmer_2s_linear_infinite] after:bg-linear-to-r after:from-transparent after:via-[rgb(255_255_255/0.55)] after:to-transparent dark:after:via-[rgb(255_255_255/0.09)]",
  },
  variants: {
    // Each shape's rows at the final box's height: a table's row; a fact, its label over its value; an editor's
    // section, its title over its fields.
    shape: {
      table: { row: "h-14 lg:h-13" },
      cards: { row: `h-24 flex-col items-start justify-center gap-2 ${cardSurface()} first:border-t` },
      // A fact's label stands over its value, the label's bar shorter and lower.
      facts: { row: "h-14 flex-col items-start justify-center gap-2" },
      sections: { row: `h-40 ${cardSurface()} first:border-t` },
      // A school tile's height, 48 px on a phone and 44 from `lg`, its plaque before its name.
      tiles: { row: `h-12 gap-2 px-2.5 lg:h-11 ${cardSurface()} first:border-t` },
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

/** Each part of the landing's first screen, apart, since the hero splits its words from the season's card. */
type LandingPart = "words" | "card" | "sections";

const landing = tv({
  extend: skeleton,
  slots: {
    // The lead's three lines and the hero's two buttons.
    lead: "grid gap-2",
    acts: "flex flex-wrap gap-3",
    button: "h-8 w-32 rounded-lg pointer-coarse:h-10",
    // The season card, the kit's card: its name and its chip in the head's band, then its body.
    cardBox: card().root(),
    cardHead: card().head(),
    cardNamed: card().named(),
    cardBody: "grid gap-3 p-4",
    // The first section: its eyebrow and title, then three cards side by side from `lg`.
    sectionHead: "grid gap-2",
    cards: "grid gap-4 lg:grid-cols-3",
    card: `grid content-start gap-3 ${cardSurface()} p-6`,
    mark: "size-10 rounded-lg",
  },
});

/**
 * The landing's first screen while its read is on its way, part by part where the hero places each: the lead and
 * the two buttons under the tagline, the season's card beside them, and the first section under both, which a
 * phone, where the hero alone fills the screen, leaves out. Each part's bars stand where its final block will,
 * so nothing moves when the read lands; one screen, never a page to scroll. The words' part carries the status.
 */
export function LandingSkeleton({ part }: { part: LandingPart }) {
  const slots = landing();
  const status = part === "words" && (
    <span
      role="status"
      className="sr-only">
      {COPY.shared.loading}
    </span>
  );
  const bars = {
    words: (
      <div className="grid gap-6">
        <div className={slots.lead()}>
          <span className={slots.bar({ class: "w-full" })} />
          <span className={slots.bar({ class: "w-full" })} />
          <span className={slots.bar({ class: "w-2/3" })} />
        </div>
        <div className={slots.acts()}>
          <span className={slots.bar({ class: slots.button() })} />
          <span className={slots.bar({ class: slots.button() })} />
        </div>
      </div>
    ),
    card: (
      <div className={slots.cardBox()}>
        <div className={slots.cardHead()}>
          <span className={slots.cardNamed()}>
            <span className={slots.bar({ class: "w-24" })} />
            <span className={slots.bar({ class: "h-5 w-16" })} />
          </span>
        </div>
        <div className={slots.cardBody()}>
          <span className={slots.bar({ class: "h-20 w-full" })} />
          <span className={slots.bar({ class: "w-2/3" })} />
        </div>
      </div>
    ),
    sections: (
      <div className="grid gap-6 max-lg:hidden">
        <div className={slots.sectionHead()}>
          <span className={slots.bar({ class: "h-3 w-24" })} />
          <span className={slots.bar({ class: "h-6 w-64" })} />
        </div>
        <div className={slots.cards()}>
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className={slots.card()}>
              <span className={slots.bar({ class: slots.mark() })} />
              <span className={slots.bar({ class: "w-1/2" })} />
              <span className={slots.bar({ class: "w-full" })} />
              <span className={slots.bar({ class: "w-3/4" })} />
            </div>
          ))}
        </div>
      </div>
    ),
  }[part];
  return (
    <div
      aria-busy
      className={slots.root()}>
      {status}
      <div aria-hidden>{bars}</div>
    </div>
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
        className={GRID[shape] ?? box()}>
        {rows}
      </div>
    </div>
  );
}
