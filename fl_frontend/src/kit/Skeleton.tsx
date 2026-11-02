import { COPY } from "@/core/copy";

import { cardSurface } from "./cardStyles";
import { tv } from "./tv";

/** The final boxes a template waits for: a table's rows, a match list's, a read page's facts, an editor's sections. */
export type SkeletonShape = "table" | "spiel" | "facts" | "sections";

/** How many rows or boxes each shape draws. */
const ROWS: Readonly<Record<SkeletonShape, number>> = { table: 8, spiel: 6, facts: 4, sections: 2 };

const skeleton = tv({
  slots: {
    // Drawn invisible and shown once the wait passes `--loading-delay`, Next's way of keeping a fast load from
    // flashing a placeholder. The longhands, never the `animation` shorthand: under reduced motion
    // `--motion-in` is unset, which would invalidate the whole shorthand and leave the box invisible, where it
    // invalidates the duration alone, which falls back to 0s, so the box appears at once.
    root: "opacity-0 [animation-delay:var(--loading-delay)] [animation-duration:var(--motion-in)] [animation-fill-mode:forwards] [animation-name:kit-appear]",
    // A box of rows, as the list, the table or the facts that will stand in its place.
    box: `overflow-hidden ${cardSurface()}`,
    row: "flex flex-col justify-center gap-2 border-t border-border px-4 first:border-t-0",
    // The base fill, with a lighter band sweeping across it every two seconds, under reduced motion too: a
    // loading indicator that stops reads as stuck.
    bar: "relative h-4 w-1/2 overflow-hidden rounded-md bg-bg-muted after:absolute after:inset-0 after:animate-[kit-shimmer_2s_linear_infinite] after:bg-linear-to-r after:from-transparent after:via-[rgb(255_255_255/0.55)] after:to-transparent dark:after:via-[rgb(255_255_255/0.09)]",
  },
  variants: {
    // Each shape's rows at the final box's height: a table's row; a match row, one line on desktop and two on
    // a phone; a fact, its label over its value; an editor's section, its title over its fields.
    shape: {
      table: { row: "h-14 lg:h-13" },
      spiel: { row: "h-24 lg:h-14" },
      facts: { row: "h-14" },
      sections: { row: `h-40 ${cardSurface()} first:border-t` },
    },
    // A label's bar, shorter and lower than its value's.
    label: {
      true: { bar: "h-3 w-1/4" },
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
    button: "h-9 w-32 rounded-lg",
    // The season card: its name and its link, then its box.
    head: "flex items-center justify-between gap-4",
    cardBox: `grid gap-3 ${cardSurface()} p-4`,
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
      <div className="grid gap-4">
        <div className={slots.head()}>
          <span className={slots.bar({ class: "w-24" })} />
          <span className={slots.bar({ class: "w-20" })} />
        </div>
        <div className={slots.cardBox()}>
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
      {shape === "facts" && <span className={skeleton({ label: true }).bar()} />}
      <span className={bar()} />
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
        className={shape === "sections" ? "grid gap-6" : box()}>
        {rows}
      </div>
    </div>
  );
}
