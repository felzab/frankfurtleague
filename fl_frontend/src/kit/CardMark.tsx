import { tv } from "./tv";

import type { FLCardColour } from "@/core/generated/client/types";

const cardMark = tv({
  // A card's own shape, 10 by 14 px, its corners the kit's smallest. The fills are the status hues, which keep their
  // contrast on every ground in both themes; the destructive button's red is darker than a dark card allows.
  base: "inline-block h-3.5 w-2.5 shrink-0 rounded-sm",
  variants: {
    colour: {
      gelb: "bg-warn",
      rot: "bg-danger",
      // Half and half, the yellow first as it was shown first, and wider than one card so each half still reads.
      gelb_rot: "w-3.5 bg-linear-to-r from-warn from-50% to-danger to-50%",
    },
  },
});

/**
 * A card's colour as a small card before its word, on the referee's form and a match's card list. For the eye alone:
 * the word beside it names the colour, so a reader who cannot tell the two hues apart misses nothing and a screen
 * reader hears the word once. It never stands without that word.
 */
export function CardMark({ colour }: { colour: FLCardColour }) {
  return (
    <span
      aria-hidden
      className={cardMark({ colour })}
    />
  );
}
