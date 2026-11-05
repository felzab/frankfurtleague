import { COPY } from "@/core/copy";

import { tv } from "./tv";

import type { ReactNode } from "react";

/**
 * The parts every block's placeholder is drawn with. A block that waits for its content draws its own placeholder
 * from its own recipe, its boxes, padding and gaps the block's, every text replaced by a `PlaceholderLine` at that
 * text's line height and every glyph, plaque or control by a `placeholderBar` of its size, so the placeholder stands
 * as tall and as wide as the block will and cannot drift from it. A template's wait is its blocks' placeholders,
 * laid out as the blocks are, inside `Waiting`.
 */
const placeholder = tv({
  slots: {
    // Drawn invisible and shown once the wait passes `--loading-delay`, Next's way of keeping a fast load from
    // flashing a placeholder. The longhands, never the `animation` shorthand: under reduced motion
    // `--motion-in` is unset, which would invalidate the whole shorthand and leave the box invisible, where it
    // invalidates the duration alone, which falls back to 0s, so the box appears at once.
    root: "opacity-0 [animation-delay:var(--loading-delay)] [animation-duration:var(--motion-in)] [animation-fill-mode:forwards] [animation-name:kit-appear]",
    // The base fill, with a lighter band sweeping across it every two seconds, under reduced motion too: a
    // loading indicator that stops reads as stuck.
    bar: "relative block shrink-0 overflow-hidden rounded-md bg-bg-muted after:absolute after:inset-0 after:animate-[kit-shimmer_2s_linear_infinite] after:bg-linear-to-r after:from-transparent after:via-[rgb(255_255_255/0.55)] after:to-transparent dark:after:via-[rgb(255_255_255/0.09)]",
    // One line of text: as tall as the line the text's own size sets (`1lh`), the bar inside it a little taller than
    // the letters' height, so a line of placeholders stands where the line of words will.
    line: "flex h-lh min-w-0 items-center",
    words: "h-[0.75em]",
  },
  variants: {
    // On a card's head band, whose dark fill is the muted fill itself, the bars take the head's own step above it, as a
    // folded head lifts under the pointer; on the dark-green band, the band's white, faint, as the band's words are white.
    ground: {
      page: {},
      head: { bar: "bg-bg-card-head-hover" },
      band: { bar: "bg-on-brand/20" },
    },
  },
});

/** Where a placeholder stands: on the page's or a card's ground, on a card's head band, or on the dark-green band. */
export type Ground = "page" | "head" | "band";

/**
 * A season's name while the season is read, as words for a placeholder's width alone: every season is named by its
 * four-figure year, so any such name is as wide as the one that lands.
 */
export const SAISON_WORDS = COPY.shared.saisonName("2027");

/** A shimmering box of its own size, for what is not a line of text: a plaque, a glyph, a control, an avatar. */
export function placeholderBar(size: string, ground: Ground = "page") {
  return placeholder({ ground }).bar({ class: size });
}

/**
 * One line of text while it is read: `text` is the size the words will be set at, whose line height the line takes,
 * and `width` how much of the line the words will fill. Where the words are known before the read, such as a menu
 * entry's name whose address waits for the season, `words` sizes the bar instead, set in it unseen, so the bar is
 * exactly as wide as they will be.
 */
export function PlaceholderLine({
  text,
  width = "",
  words,
  ground = "page",
}: { text: string; ground?: Ground } & ({ width: string; words?: never } | { words: string; width?: never })) {
  const slots = placeholder({ ground });
  return (
    <span className={slots.line({ class: text })}>
      <span className={slots.bar({ class: `${slots.words()} ${width} ${words === undefined ? "" : "whitespace-nowrap text-transparent"}` })}>
        {words}
      </span>
    </span>
  );
}

/**
 * A part of the frame while it waits, such as the rail's entries or the season button: its placeholder, hidden from
 * assistive technology and shown only once the wait outlasts `--loading-delay`. It says nothing itself: the page's
 * own wait carries the status. `layout` is the box the part stands in, as the part's own root lays out its children.
 */
export function Placeholder({ layout = "", children }: { layout?: string; children: ReactNode }) {
  return (
    <div
      aria-hidden
      className={placeholder().root({ class: layout })}>
      {children}
    </div>
  );
}

/**
 * Waiting for a template's content: its blocks' placeholders, shown only once the wait outlasts `--loading-delay`
 * (`tokens.css`). Its status says „Lädt“ in its subtree, which a live region announces where its name alone is not,
 * and the box standing in the content's place is busy. A template places it as its one boundary's fallback; `layout`
 * is the box the content will stand in, such as a column's gaps, and `status` is left out by every part but one where
 * a wait is drawn in several parts, so the wait is announced once.
 */
export function Waiting({ layout = "", status = true, children }: { layout?: string; status?: boolean; children: ReactNode }) {
  return (
    <div
      aria-busy
      className={placeholder().root()}>
      {status && (
        <span
          role="status"
          className="sr-only">
          {COPY.shared.loading}
        </span>
      )}
      <div
        aria-hidden
        className={layout}>
        {children}
      </div>
    </div>
  );
}
