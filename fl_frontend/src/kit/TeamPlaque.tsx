import { tv } from "./tv";

import type { Copy, RecordText } from "@/core/copy";

const plaque = tv({
  // `align-middle` centres it on the line where it stands in a line of text, as inside a table row's link;
  // a flex or grid parent, which centres it everywhere else, ignores it.
  base: "inline-flex h-6 w-10 shrink-0 items-center justify-center rounded-md align-middle font-numeric text-xs tracking-display uppercase",
  variants: {
    known: {
      // The text colour at the chip's tint over whatever it stands on, so it rises one step off the page, a
      // card and a card's head alike, in both themes.
      true: "bg-fg/12 font-semibold text-fg",
      // A side the draw has not settled: dashed and muted, its source in place of a club.
      false: "border border-dashed border-border-control bg-transparent font-medium text-fg-muted",
    },
  },
});

/**
 * What a plaque holds: the club's Kürzel, its record's own data, or, for a side not yet known, its source short,
 * „A1“ or „S25“, and `null` for a side with neither a club nor a source yet.
 */
export type Plaque = RecordText | { quelle: Copy | null };

/** The 40 × 24-px plaque before a club's name, holding its three-letter Kürzel; one size for every place. */
export function TeamPlaque({ plaque: held }: { plaque: Plaque }) {
  return "record" in held ? (
    <span className={plaque({ known: true })}>{held.record}</span>
  ) : (
    <span className={plaque({ known: false })}>{held.quelle}</span>
  );
}
