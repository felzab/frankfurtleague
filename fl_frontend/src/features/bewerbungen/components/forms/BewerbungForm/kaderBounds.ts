import { BEWERBUNG_KADER_GROESSE_MAX } from "@/features/bewerbungen/constants";

import type { BewerbungFormDraft } from "@/features/bewerbungen/types";

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

/**
 * The squad block once its size moves. The strong count comes down with the ceiling: its box already shows the
 * clamped number, and a draft left on the old one is refused at submit under two boxes reading alike.
 */
export function kaderWithSquad(kader: BewerbungFormDraft["kader"], squad: number | null): BewerbungFormDraft["kader"] {
  const ceiling = strongPlayerCeiling(squad);

  // Never raised: a count nobody entered stays `null`, and a higher ceiling gives back nothing an earlier clamp took.
  return { voraussichtliche_groesse: squad, gute_spieler: kader.gute_spieler === null ? null : Math.min(kader.gute_spieler, ceiling) };
}
