import { COPY } from "@/core/copy";

import type { Copy } from "@/core/copy";
import type { FLAustrittType, FLKontaktRolle, FLTrainerAlso, FLTrikotFarbe } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";

// Keyed by every route, so a route the contract adds fails to compile until the catalogue words it.
const AUSTRITT_WORDS: Record<FLAustrittType, { readonly state: Copy; readonly shorthand: Copy }> = COPY.shared.austritt;

/** The state a club is in once the record exists — `Disqualifiziert seit …`, `Zurückgezogen seit …`. */
export function austrittState(type: FLAustrittType): Copy {
  return AUSTRITT_WORDS[type].state;
}

/** The badge form, for a table cell, a popover or a chip, where only two letters have room. */
function austrittKuerzel(type: FLAustrittType): Copy {
  return AUSTRITT_WORDS[type].shorthand;
}

// A disqualification is the league's sanction, so its chip takes the danger hue; a withdrawal is the club's own act.
const AUSTRITT_TONE = { disqualifikation: "danger", rueckzug: "neutral" } as const satisfies Record<FLAustrittType, ChipProps["tone"]>;

/**
 * A club's exit chip, after its name wherever a public list or its page names it: the route's two letters, which a
 * screen reader hears as the club's state, so every public surface draws one chip for one record.
 */
export function austrittChip(type: FLAustrittType): ChipProps {
  return { tone: AUSTRITT_TONE[type], label: austrittKuerzel(type), spoken: austrittState(type) };
}

/**
 * The chip after a club's name in the administration: „Stillgelegt“ once it left the league, else how it left the
 * season, whichever route, in the danger hue and in the full word, which the list and the editor have room for.
 */
export function adminTeamChip(retiredSince: string | null, exit: FLAustrittType | null): ChipProps | undefined {
  if (retiredSince !== null) return { tone: "neutral", label: COPY.shared.retired };
  return exit === null ? undefined : { tone: "danger", label: austrittState(exit) };
}

export function trikotFarbeLabel(farbe: FLTrikotFarbe): string {
  return COPY.team.trikotFarbeName[farbe];
}

/**
 * The three seats a season holds per club, in every surface's order, the Trainer first as the application form draws
 * them; each is named by the catalogue (`COPY.team.seatName`, `rollenText`).
 */
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
