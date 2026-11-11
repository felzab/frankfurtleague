import { COPY } from "@/core/copy";

import type { Words } from "@/core/copy";
import type { Pair } from "@/core/format";
import type { FLSaisonPhase, FLSonderereignis, FLSpielSide } from "@/core/generated/client/types";
import type { ScoreOutcome } from "@/kit/ScoreRows";

/**
 * One place for the rules a match's result is read by, so the administrator's preview and the referee's never read a
 * match apart.
 */

/** The two no-shows, whose goals the league composes from the season's rules and which take no goal of their own. */
type NoShow = Extract<FLSonderereignis, "nichtantreten_team1" | "nichtantreten_team2">;

/** Whether a Sonderereignis, or a select's choice of one, is a no-show. */
export const isNoShow = (sonderereignis: string | null): sonderereignis is NoShow =>
  sonderereignis === "nichtantreten_team1" || sonderereignis === "nichtantreten_team2";

export const creditedSide = ({ side, eigentor }: { side: FLSpielSide; eigentor: boolean }): FLSpielSide =>
  eigentor ? (side === "team1" ? "team2" : "team1") : side;

/** A side as the rule reads it: its goals alone, `null` while none are entered. */
type Side = { readonly tore: number | null } | null;

/**
 * Whether a fixture takes a shoot-out: a knockout match whose two sides' goals are entered and level, and which no
 * no-show decided. The write keeps a shoot-out on exactly these and drops it anywhere else, so the match editor and the
 * referee's report offer the pair where it would stand.
 */
export function admitsShootOut(saisonPhase: FLSaisonPhase, team1: Side, team2: Side, sonderereignis: FLSonderereignis | null): boolean {
  if (saisonPhase === "gruppenphase") return false;

  // A no-show's award is composed from the season's `forfeit_ergebnis`, which a grandfathered season may hold level, so a
  // kept shoot-out would advance the club that never appeared.
  if (isNoShow(sonderereignis)) return false;

  const tore1 = team1?.tore ?? null;
  const tore2 = team2?.tore ?? null;
  return tore1 !== null && tore2 !== null && tore1 === tore2;
}

export function scoreOutcome(goals: Pair, added: Pair | null, names: readonly [Words, Words]): ScoreOutcome {
  const words = COPY.admin.spiel;
  const score = words.score(goals, added);
  const [one, other] = [goals.team1 + (added?.team1 ?? 0), goals.team2 + (added?.team2 ?? 0)];
  if (one === other) return { text: words.drawn(score), tone: "draw" };
  return { text: words.wins(one > other ? names[0] : names[1], score), tone: "win" };
}
