import { ImElfmeterschiessen } from "./ImElfmeterschiessen";

import type { ErgebnisTone } from "../../utils";

/**
 * A score's ink on a ground that is not a pill's: `-strong`, the tokens' rule being plain for fills and
 * `-strong` for text. The bracket's score is a pill and takes `PILL_TINT` instead.
 */
export const ERGEBNIS_INK: Record<ErgebnisTone, string> = {
  success: "text-success-strong",
  danger: "text-danger-strong",
  warning: "text-warning-strong",
};

/**
 * The score, and under it the shoot-out — **never folded into the score**: the fixture finished
 * level and the Saisontabelle counts it as a draw, so a card showing the shoot-out's numbers as the
 * result would contradict the table about the same match.
 */
export function SpielScore({
  ergebnis,
  elfmeterschiessen,
  className,
}: {
  ergebnis: string;
  /** The counts alone, `formatElfmeterschiessen`'s: the mark beside them is this component's. */
  elfmeterschiessen: string | null;
  /** Layout and the played/unplayed colour, which each surface spells in its own vocabulary. */
  className: string;
}) {
  return (
    <span className={`font-numeric tabular-nums ${className}`}>
      {ergebnis}
      {elfmeterschiessen !== null && (
        <span className="fluid-xxs font-semibold whitespace-nowrap">
          {elfmeterschiessen}
          {" "}
          <ImElfmeterschiessen />
        </span>
      )}
    </span>
  );
}
