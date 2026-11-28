import { COPY } from "@/core/copy/shared";
import { FLKontaktSeat } from "@/core/generated/client/types";
import { ACTIVE_CHIP, RETIRED_CHIP } from "@/kit/stateChips";

import type { Copy } from "@/core/copy";
import type { FLAustrittType, FLTeamShorthandLength, FLTrainerAlso, FLTrikotFarbe } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";

// Keyed by every route, so a route the contract adds fails to compile until the catalogue words it.
const AUSTRITT_WORDS: Record<FLAustrittType, { readonly state: Copy; readonly shorthand: Copy }> = COPY.shared.austritt;

export function austrittState(type: FLAustrittType): Copy {
  return AUSTRITT_WORDS[type].state;
}

function austrittKuerzel(type: FLAustrittType): Copy {
  return AUSTRITT_WORDS[type].shorthand;
}

/**
 * A club's exit chip, after its name wherever a public list or its page names it: the route's two letters, which a
 * screen reader hears as the club's state, so every public surface draws one chip for one record. Red by either route:
 * a withdrawal takes the danger hue as a disqualification does.
 */
export function austrittChip(type: FLAustrittType): ChipProps {
  return { tone: "danger", label: austrittKuerzel(type), spoken: austrittState(type) };
}

/**
 * The chip after a club's name in the administration: „Stillgelegt“ once it left the league, else how it left the
 * season, red as the public chip draws it, and in the full word, which the list and the editor have room for; „Aktiv“
 * while it plays on.
 */
export function adminTeamChip(retiredSince: string | null, exit: FLAustrittType | null): ChipProps {
  if (retiredSince !== null) return RETIRED_CHIP;
  return exit === null ? ACTIVE_CHIP : { tone: "danger", label: austrittState(exit) };
}

/**
 * A client control cannot import the generated module that holds the pattern, so a control's `maxLength` and the check
 * of a complete code read the length from here.
 */
export const SHORTHAND_LENGTH = 3 satisfies FLTeamShorthandLength;

export function trikotFarbeLabel(farbe: FLTrikotFarbe): Copy {
  return COPY.team.trikotFarbeName[farbe];
}

/** Every seat, in the contract's order, which is every surface's: the Trainer first. */
export const KONTAKT_SEATS: readonly FLKontaktSeat[] = Object.values(FLKontaktSeat);

/**
 * The seat a double-seated Trainer's row stands for, on an application and on a club alike: one person holds both and
 * one link answers both, so a second row would offer a second press for one mail. An emptied Trainer's seat stands for
 * nobody.
 */
export function seatBesideTrainer({
  trainer,
  trainer_is_also: also,
}: {
  trainer: unknown;
  trainer_is_also: FLTrainerAlso | null;
}): FLTrainerAlso | null {
  return trainer === null ? null : also;
}
