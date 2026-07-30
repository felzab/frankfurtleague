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

/** Kept in step with `FLSpielSchema.ergebnis`, which enforces the same shape at the API boundary. */
const ERGEBNIS_PATTERN = /^(\d+):(\d+)$/;

/**
 * Derives a result for `teamId` from the `ergebnis` wire string.
 *
 * Parsing `ergebnis` is `spiele` domain knowledge — the format is declared by `FLSpielSchema` —
 * so it belongs here rather than inline in a `teams` view.
 *
 * The length and NaN guards are not defensive padding: the inline version this replaced split the
 * string and indexed it without checking, so a malformed `"3"` produced `Number(undefined) === NaN`,
 * made every comparison false, and silently reported a **loss**. It returns "?" instead.
 */
export const computeErgebnisFor = ({ spiel, teamId }: { spiel: FLSpiel; teamId: string }): FLSpielErgebnisFor => {
  // Matched against the same pattern FLSpielSchema.ergebnis enforces, rather than split on ":".
  // A length-2 check is not sufficient: ":" splits into two empty strings and Number("") is 0, not
  // NaN, so it would be read as a 0:0 draw. "3:" would read as a win.
  const match = spiel.ergebnis?.match(ERGEBNIS_PATTERN);
  if (!match) return "?";

  const isTeam1 = spiel.team1.team_id === teamId;
  const own = Number(match[isTeam1 ? 1 : 2]);
  const other = Number(match[isTeam1 ? 2 : 1]);
  if (Number.isNaN(own) || Number.isNaN(other)) return "?";

  return own === other ? "D" : own > other ? "W" : "L";
};
