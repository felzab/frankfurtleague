import type { FLSpiel, FLSpielStatus } from "./schemas";

export const computeSpielStatus = ({
  datum,
  isCanceled,
  today,
}: {
  datum: string | null;
  isCanceled: boolean;
  today: string;
}): FLSpielStatus => {
  if (isCanceled) return "abgesagt";
  if (datum === null) return "unbekannt";
  if (datum > today) return "ausstehend";
  if (datum === today) return "heute";
  return "vergangen";
};

/** Win / loss / draw / unknown, from one team's point of view. */
export type FLSpielErgebnisFor = "W" | "L" | "D" | "?";

/**
 * Kept in step with `FLSpielSchema.ergebnis`, which enforces the same shape at the API boundary.
 * `[0-9]`, not `\d`: the backend's rust-regex `\d` is Unicode-aware, and `Number("٢")` is `NaN`.
 */
const ERGEBNIS_PATTERN = /^([0-9]+):([0-9]+)$/;

/**
 * Derives a result for `teamId` from the `ergebnis` wire string.
 *
 * Parsing `ergebnis` is `spiele` domain knowledge — the format is declared by `FLSpielSchema` —
 * so it belongs here rather than inline in a `teams` view.
 *
 * Returns "?" for anything it cannot read with certainty, which covers three distinct cases:
 * an unplayed match (`ergebnis` is null), a malformed value, and a `teamId` that is not one of the
 * two competing teams. That last one matters — the obvious `teamId === team1.team_id` two-way
 * branch scores an unknown team from team2's point of view, so a stale embedded id renders a
 * confident **loss** for a team that did not play. That is the same silent-loss defect this
 * function was extracted to remove, one level up.
 */
export const computeErgebnisFor = ({ spiel, teamId }: { spiel: FLSpiel; teamId: string }): FLSpielErgebnisFor => {
  // Matched against the pattern FLSpielSchema.ergebnis enforces, rather than split on ":".
  // A length-2 check is not sufficient: ":" splits into two empty strings and Number("") is 0, not
  // NaN, so it would be read as a 0:0 draw. "3:" would read as a win.
  const match = spiel.ergebnis?.match(ERGEBNIS_PATTERN);
  if (!match) return "?";

  // Three-way, not two-way: neither side matching is "unknown", not "team2".
  const side = teamId === spiel.team1.team_id ? 1 : teamId === spiel.team2.team_id ? 2 : null;
  if (side === null) return "?";

  const own = Number(match[side]);
  const other = Number(match[side === 1 ? 2 : 1]);

  return own === other ? "D" : own > other ? "W" : "L";
};
