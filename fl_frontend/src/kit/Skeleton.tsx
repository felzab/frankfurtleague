import { COPY } from "@/core/copy";

import { tv } from "./tv";

import type { ReactNode } from "react";

/**
 * The parts every block's placeholder is drawn with. A block that waits for its content draws its own placeholder
 * from its own recipe, its boxes, padding and gaps the block's, every text replaced by a `PlaceholderLine` at that
 * text's line height and every glyph, plaque or control by a `placeholderBar` of its size, so the placeholder stands
 * as tall and as wide as the block will and cannot drift from it. A template's wait is its blocks' placeholders,
 * laid out as the blocks are, inside `Waiting`.
 *
 * A wait is the page at its real size, since the browser restores a reload against it. Every part above a streamed
 * hole stands at exactly its landed height. A list draws its own usual size, at most 30 rows or cards, the number its
 * page states beside it, a list that fits a screen included, so a list landing short does not shrink. A part whose
 * state the read decides draws, on a rail page, its taller state: nothing stands under `main` there, so a taller wait
 * collapses unseen where a shorter one loses a reload's place for good. On a classic page, whose footer a collapse
 * would lift into view, it draws the state that lands most often. No static shell knows who reads, so a part one role
 * alone holds draws no wait, and a part the role reshapes draws its usual shape until a first read says otherwise
 * (`AccountPage`'s `waitOnceRead`). A placeholder never shows a state's words.
 */
const placeholder = tv({
  slots: {
    // Nothing in it can be pressed, so nothing in it answers the pointer: a placeholder drawn with a control's or a row's
    // recipe borrows its box, never its hover or its hand, and `pointer-events` is inherited, so this holds for every
    // part inside.
    root: "pointer-events-none",
    // The one recipe on every ground (`tokens.css`). Its pulse runs under reduced motion too: a loading indicator that
    // stops reads as stuck.
    bar: "skeleton-bar",
    // One line of text: as tall as the line the text's own size sets (`1lh`), the bar inside it a little taller than
    // the letters' height, so a line of placeholders stands where the line of words will.
    line: "flex h-lh min-w-0 items-center",
    words: "h-[0.75em]",
  },
});

/**
 * A season's name while the season is read, as words for a placeholder's width alone: every season is named by its
 * four-figure year, so any such name is as wide as the one that lands.
 */
export const SAISON_WORDS = COPY.shared.saisonName("2027");

/** A pulsing box of its own size, for what is not a line of text: a plaque, a glyph, a control, an avatar. */
export function placeholderBar(size: string) {
  return placeholder().bar({ class: size });
}

/**
 * One line of text while it is read: `textClass` is the size the words will be set at, whose line height the line takes,
 * and `widthClass` how much of the line the words will fill. Where the words are known before the read, such as a menu
 * entry's name whose address waits for the season, `words` sizes the bar instead, set in it unseen, so the bar is
 * exactly as wide as they will be.
 */
export function PlaceholderLine({
  textClass,
  widthClass = "",
  words,
}: { textClass: string } & ({ widthClass: string; words?: never } | { words: string; widthClass?: never })) {
  const slots = placeholder();
  return (
    <span className={slots.line({ class: textClass })}>
      <span
        className={slots.bar({ class: `${slots.words()} ${widthClass} ${words === undefined ? "" : "whitespace-nowrap text-transparent"}` })}>
        {words}
      </span>
    </span>
  );
}

/** The fewest characters a line of a sentence holds, on the narrowest phone, so a sentence never runs out of bars. */
const CHARACTERS_PER_LINE = 30;

/**
 * A sentence whose words are known before the read, in a box that wraps it: `textClass` is the size it will be set at. The
 * words wrap unseen, so the sentence stands as many lines as it will at every width, and cut the bars laid over them
 * to the lines they hold. `lines` is the most lines they can take, for a narrower box than a sentence's.
 */
export function PlaceholderSentence({
  textClass,
  words,
  lines = Math.ceil(words.length / CHARACTERS_PER_LINE),
}: {
  textClass: string;
  words: string;
  lines?: number;
}) {
  return (
    <span className={`relative block overflow-hidden ${textClass}`}>
      <span className="invisible">{words}</span>
      <span className="absolute inset-0">
        {Array.from({ length: lines }, (_, line) => (
          <PlaceholderLine
            key={line}
            textClass=""
            widthClass="w-full"
          />
        ))}
      </span>
    </span>
  );
}

/**
 * A part of the frame while it waits, such as the rail's entries or the season button: its placeholder, hidden from
 * assistive technology. It says nothing itself: the page's
 * own wait carries the status. `layoutClass` is the box the part stands in, as the part's own root lays out its children.
 */
export function Placeholder({ layoutClass = "", children }: { layoutClass?: string; children: ReactNode }) {
  return (
    <div
      aria-hidden
      className={placeholder().root({ class: layoutClass })}>
      {children}
    </div>
  );
}

/**
 * Waiting for a template's content: its blocks' placeholders. The box standing in the content's place is busy. A
 * template places it as its one boundary's fallback;
 * `layoutClass` is the box the content will stand in, such as a column's gaps.
 */
export function Waiting({ layoutClass = "", children }: { layoutClass?: string; children: ReactNode }) {
  return (
    <div
      aria-busy
      className={placeholder().root()}>
      <div
        aria-hidden
        className={layoutClass}>
        {children}
      </div>
    </div>
  );
}
