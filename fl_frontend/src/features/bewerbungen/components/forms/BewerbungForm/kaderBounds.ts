import { BEWERBUNG_KADER_GROESSE_MAX } from "@/features/bewerbungen/constants";

/**
 * The largest strong-player count the write path accepts for a squad of this size.
 *
 * Its own module so a test can parse it. Inline in the JSX it reads back only as text, and a check
 * reading text passes whatever the expression does.
 */
export function strongPlayerCeiling(squad: number | null): number {
  // Composed, never either half alone: an unanswered squad still caps at the league's ceiling, and a
  // squad above that ceiling may not raise the cap past what the schema takes.
  return Math.min(squad ?? BEWERBUNG_KADER_GROESSE_MAX, BEWERBUNG_KADER_GROESSE_MAX);
}
