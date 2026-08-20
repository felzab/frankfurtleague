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
  elfmeterschiessen: string | null;
  /** Layout and the played/unplayed colour, which each surface spells in its own vocabulary. */
  className: string;
}) {
  return (
    <span className={className}>
      {ergebnis}
      {elfmeterschiessen !== null && <span className="fluid-xxs font-semibold whitespace-nowrap">{elfmeterschiessen}</span>}
    </span>
  );
}
