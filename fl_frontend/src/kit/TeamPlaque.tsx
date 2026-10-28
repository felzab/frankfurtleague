import { tv } from "./tv";

const plaque = tv({
  base: "inline-flex h-6 w-10 shrink-0 items-center justify-center rounded-md font-numeric text-xs tracking-display uppercase tabular-nums",
  variants: {
    known: {
      true: "bg-bg-muted font-semibold text-fg",
      // A side the draw has not settled: dashed and muted, its source in place of a club.
      false: "border border-dashed border-border-control bg-transparent font-medium text-fg-muted",
    },
  },
});

/**
 * The 40 × 24-px plaque before a club's name, holding its three-letter Kürzel; one size for every place.
 * A side not yet known shows its source short instead, „A1“ or „S25“, in a dashed plaque.
 */
export function TeamPlaque(props: { kuerzel: string; quelle?: never } | { quelle: string; kuerzel?: never }) {
  return props.kuerzel !== undefined ? (
    <span className={plaque({ known: true })}>{props.kuerzel}</span>
  ) : (
    <span className={plaque({ known: false })}>{props.quelle}</span>
  );
}
