import { ACTIVE_CHIP, RETIRED_CHIP } from "@/kit/stateChips";

import { COPY } from "@/core/copy";

import type { Copy } from "@/core/copy";
import type { FLAustrittType, FLKontaktRolle, FLTrainerAlso, FLTrikotFarbe } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";

// Keyed by every route, so a route the contract adds fails to compile until the catalogue words it.
const AUSTRITT_WORDS: Record<FLAustrittType, { readonly state: Copy; readonly shorthand: Copy }> = COPY.shared.austritt;

export function austrittState(type: FLAustrittType): Copy {
  return AUSTRITT_WORDS[type].state;
}

function austrittKuerzel(type: FLAustrittType): Copy {
  return AUSTRITT_WORDS[type].shorthand;
}

// Each route's hue, the public two letters' and the administration's word alike: a club out of the season by either
// route takes the danger hue, a withdrawal as a disqualification does.
const AUSTRITT_TONE = { disqualifikation: "danger", rueckzug: "danger" } as const satisfies Record<FLAustrittType, ChipProps["tone"]>;

/**
 * A club's exit chip, after its name wherever a public list or its page names it: the route's two letters, which a
 * screen reader hears as the club's state, so every public surface draws one chip for one record.
 */
export function austrittChip(type: FLAustrittType): ChipProps {
  return { tone: AUSTRITT_TONE[type], label: austrittKuerzel(type), spoken: austrittState(type) };
}

/**
 * The chip after a club's name in the administration, the list's „Stand“ column's and the editor's head alike:
 * „Stillgelegt“ once it left the league, else how it left the season, in its route's hue, as the public chip draws it,
 * and in the full word, which the list and the editor have room for; „Aktiv“ while it plays on.
 */
export function adminTeamChip(retiredSince: string | null, exit: FLAustrittType | null): ChipProps {
  if (retiredSince !== null) return RETIRED_CHIP;
  return exit === null ? ACTIVE_CHIP : { tone: AUSTRITT_TONE[exit], label: austrittState(exit) };
}

export function trikotFarbeLabel(farbe: FLTrikotFarbe): Copy {
  return COPY.team.trikotFarbeName[farbe];
}

/** In every surface's order, the Trainer first as the application form draws them. */
export const KONTAKT_ROLLEN = ["trainer", "ansprechperson", "stellvertretung"] as const satisfies readonly FLKontaktRolle[];

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
