import type { FLCardColour, FLSpielberichtSchiedsrichterResponse, FLSpielSide } from "@/core/generated/client/types";

/** The Sonderereignis' first entry, nothing beyond the match being played: a select's choice is a string. */
export const NO_SONDEREREIGNIS = "none";

/**
 * The player list's first entry on a goal, a scorer nobody can name, which the write takes as a null player; a row's
 * `null` is a player not yet chosen, which the write refuses.
 */
export const UNKNOWN_SCORER = "unknown";

/** One goal as its row holds it: a new row's side and player are `null` until chosen, so no goal is credited by default. */
export type Goal = { side: FLSpielSide | null; spieler_id: string | null; minute: string; eigentor: boolean };

/** One card as its row holds it, its side, player and colour `null` until chosen. */
export type Card = { side: FLSpielSide | null; spieler_id: string | null; minute: string; colour: FLCardColour | null };

/** The report's fields as its form holds them. The goals' counts are no field: the write counts them from the goals. */
export type BerichtValues = {
  sonderereignis: string;
  shootOut1: string;
  shootOut2: string;
  scorers: ReadonlyArray<Goal>;
  cards: ReadonlyArray<Card>;
  remarks: string;
};

type Read = Pick<FLSpielberichtSchiedsrichterResponse, "bericht" | "kader" | "sides_changed">;

/**
 * The stored report as the form's values, an empty form where none is stored. On a side fielding another club since
 * the report was last written, each row naming a pupil outside that side's squad now loses its player: the write
 * refuses to name them there, so the referee picks each anew, and the save writes the report about the clubs playing.
 */
export function valuesOf({ bericht, kader, sides_changed: changed }: Read): BerichtValues {
  if (bericht === null) return { sonderereignis: NO_SONDEREREIGNIS, shootOut1: "", shootOut2: "", scorers: [], cards: [], remarks: "" };
  const departed = (side: FLSpielSide, spielerId: string) =>
    changed.includes(side) && !kader[side].some((spieler) => spieler.spieler_id === spielerId);
  const { sonderereignis, elfmeterschiessen } = bericht.ergebnis_vorschlag;
  return {
    sonderereignis: sonderereignis ?? NO_SONDEREREIGNIS,
    shootOut1: elfmeterschiessen === null ? "" : String(elfmeterschiessen.team1),
    shootOut2: elfmeterschiessen === null ? "" : String(elfmeterschiessen.team2),
    scorers: bericht.scorers.map(({ side, spieler_id: spielerId, minute, eigentor }) => ({
      side,
      spieler_id: spielerId === null ? UNKNOWN_SCORER : departed(side, spielerId) ? null : spielerId,
      minute,
      eigentor,
    })),
    cards: bericht.cards.map(({ side, spieler_id: spielerId, minute, colour }) => ({
      side,
      spieler_id: spielerId === null ? UNKNOWN_SCORER : departed(side, spielerId) ? null : spielerId,
      minute,
      colour,
    })),
    remarks: bericht.remarks ?? "",
  };
}

/**
 * Each side's goals as the write counts them from the goals entered: an own goal is scored by its row's side and
 * counts for the other one, and a row whose side is not chosen counts for neither.
 */
export function counted(scorers: ReadonlyArray<{ side: FLSpielSide | null; eigentor: boolean }>): { team1: number; team2: number } {
  const score = { team1: 0, team2: 0 };
  for (const { side, eigentor } of scorers) {
    if (side === null) continue;
    score[eigentor ? (side === "team1" ? "team2" : "team1") : side] += 1;
  }
  return score;
}

/** Whether the Sonderereignis is a no-show, whose goals the league composes and which takes no goal of its own. */
export const isNoShow = (sonderereignis: string | null): boolean =>
  sonderereignis === "nichtantreten_team1" || sonderereignis === "nichtantreten_team2";
