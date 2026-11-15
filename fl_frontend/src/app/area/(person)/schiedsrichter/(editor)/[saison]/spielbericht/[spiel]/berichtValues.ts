import { FLSpielberichtVorschlagSonderereignis } from "@/core/generated/client/types";
import { creditedSide } from "@/features/spiele/result";

import type { FLCardColour, FLSpielberichtSchiedsrichterResponse, FLSpielSide } from "@/core/generated/client/types";
import type { EditorSave } from "@/kit/useEditor";

/** The Sonderereignis' first entry, nothing beyond the match being played: a select's choice is a string. */
export const NO_SONDEREREIGNIS = "none";

/**
 * The player list's first entry on a goal and a card, a player nobody can name, which the write takes as a null player;
 * a row's `null` is a player not yet chosen, which the form refuses.
 */
export const UNKNOWN_PLAYER = "unknown";

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

type Read = Pick<FLSpielberichtSchiedsrichterResponse, "bericht" | "kader" | "sides_changed" | "spiel">;

/** The events a referee may state, as the report's write publishes them: a match called off or struck out takes no report. */
const STATED_EVENTS: ReadonlyArray<string> = Object.values(FLSpielberichtVorschlagSonderereignis);

/**
 * The stored report as the form's values. Where none is stored, an empty form opening at the event the league holds
 * for the match where it is one the referee may state, so the page reads as it does once the referee picked it. On a
 * side fielding another club since the report was last written, each row naming a pupil outside that side's squad now
 * loses its player: the write refuses to name them there, so the referee picks each anew, and the save writes the
 * report about the clubs playing.
 */
export function valuesOf({ bericht, kader, sides_changed: changed, spiel }: Read): BerichtValues {
  if (bericht === null) {
    const held = spiel.sonderereignis;
    const sonderereignis = held !== null && STATED_EVENTS.includes(held) ? held : NO_SONDEREREIGNIS;
    return { sonderereignis, shootOut1: "", shootOut2: "", scorers: [], cards: [], remarks: "" };
  }
  const departed = (side: FLSpielSide, spielerId: string) =>
    changed.includes(side) && !kader[side].some((spieler) => spieler.spieler_id === spielerId);
  const { sonderereignis, elfmeterschiessen } = bericht.ergebnis_vorschlag;
  return {
    sonderereignis: sonderereignis ?? NO_SONDEREREIGNIS,
    shootOut1: elfmeterschiessen === null ? "" : String(elfmeterschiessen.team1),
    shootOut2: elfmeterschiessen === null ? "" : String(elfmeterschiessen.team2),
    scorers: bericht.scorers.map(({ side, spieler_id: spielerId, minute, eigentor }) => ({
      side,
      spieler_id: spielerId === null ? UNKNOWN_PLAYER : departed(side, spielerId) ? null : spielerId,
      minute,
      eigentor,
    })),
    cards: bericht.cards.map(({ side, spieler_id: spielerId, minute, colour }) => ({
      side,
      spieler_id: spielerId === null ? UNKNOWN_PLAYER : departed(side, spielerId) ? null : spielerId,
      minute,
      colour,
    })),
    remarks: bericht.remarks ?? "",
  };
}

/**
 * What a save sends, the whole form on the report's first save. The editor counts its changes against the values the
 * form opened at, so an event the form opened at from the league's match, saved untouched, would otherwise reach the
 * write as no change, and the write would store the empty report's none in its place.
 */
export function wholeOnFirstSave(
  opened: BerichtValues,
  sent: EditorSave<BerichtValues, number | null>,
): EditorSave<BerichtValues, number | null> {
  return sent.version === null ? { ...sent, changes: { ...opened, ...sent.changes } } : sent;
}

/** Each side's goals as the write counts them from the goals entered: a row whose side is not chosen counts for neither. */
export function counted(scorers: ReadonlyArray<{ side: FLSpielSide | null; eigentor: boolean }>): { team1: number; team2: number } {
  const score = { team1: 0, team2: 0 };
  for (const { side, eigentor } of scorers) {
    if (side !== null) score[creditedSide({ side, eigentor })] += 1;
  }
  return score;
}
