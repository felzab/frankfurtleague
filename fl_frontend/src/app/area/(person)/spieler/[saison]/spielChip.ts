import { COPY } from "@/core/copy";

import type { FLSpielerSaisonSelfSpiel } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";

/**
 * The one chip a match's card carries on the pupil's own page, beyond what befell the match, whose chip the match's
 * row brings and which wins: the pupil's place in their club's line-up, „In der Startelf“ or „Auf der Bank“, said to the
 * pupil, while their squad row
 * stands; else „Vorläufig“ while the date is not confirmed. A deregistered pupil's cards carry no line-up chip.
 */
export function spielChipOf(
  spiel: Pick<FLSpielerSaisonSelfSpiel, "sonderereignis" | "starts" | "ansetzung_confirmed">,
  deregistered: boolean,
): ChipProps | undefined {
  if (spiel.sonderereignis !== null) return undefined;
  if (!deregistered && spiel.starts === true) return { tone: "success", label: COPY.area.spieler.lineupPlace.starts };
  if (!deregistered && spiel.starts === false) return { tone: "neutral", label: COPY.area.spieler.lineupPlace.bench };
  return spiel.ansetzung_confirmed === false ? { tone: "warn", label: COPY.admin.spiel.provisional } : undefined;
}
