import { COPY } from "@/core/copy";
import { dayOf, formatDatumWithWeekday, formatUhrzeit, timeOf } from "@/core/format";
import { buildMapsSearchUrl } from "@/core/maps";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { spieltagLabel } from "@/features/spieltage/utils";

import type { Copy } from "@/core/copy";
import type { Pair } from "@/core/format";
import type {
  FLSonderereignis,
  FLSpielJoined,
  FLSpielPageResponse,
  FLSpielQuelle,
  FLSpielSideStanding,
  FLSpielSideStandings,
  FLSpielTeamFieldJoined,
} from "@/core/generated/client/types";
import type { Fact } from "@/kit/Facts";
import type { SpielHeadProps } from "@/kit/SpielHead";
import type { SpielRowProps, SpielSide } from "@/kit/SpielRow";
import type { Outcome } from "@/kit/Timeline";
import type { Route } from "next";

/**
 * A match as the kit's blocks show it, built once for every season page, the match page and the pop-up, the
 * landing's among them: its sides, its row, its head and its facts, from the public read's match.
 */

/** A match's two sides, each a club or, while the draw has not settled it, where it comes from: the public read's and the admin read's alike. */
type Sides = Pick<FLSpielJoined, "team1" | "team2" | "team1_quelle" | "team2_quelle">;

/** A match's matchday as the page reads serve it beside the match: its `position`, and its phase's count of matchdays. */
type Matchday = Pick<FLSpielPageResponse, "spieltag_position" | "count_spieltage_in_phase">;

/**
 * What a matchday is called where the page names a single one: as the Spielplan's tabs name it (`spieltagLabel`),
 * a knockout round spread over several matchdays numbered among them, and the third-place match by its own name.
 */
export function matchdayOf(spiel: Pick<FLSpielJoined, "saison_phase" | "for_third_place">, matchday: Matchday): Copy {
  if (spiel.for_third_place) return SERVER_COPY.season.thirdPlace;
  return spieltagLabel({ phase: spiel.saison_phase, ordinal: matchday.spieltag_position, countInPhase: matchday.count_spieltage_in_phase });
}

/**
 * A played match's goals, the first side's first, as each side carries them: the backend writes
 * `ergebnis` from these and reads it only as the mark that the match was played. A hand edit holding
 * `ergebnis` without both sides' goals shows no result, as the bracket counts none.
 */
function toreOf(spiel: FLSpielJoined): Pair | null {
  const team1 = spiel.team1?.tore ?? null;
  const team2 = spiel.team2?.tore ?? null;
  return spiel.ergebnis === null || team1 === null || team2 === null ? null : { team1, team2 };
}

/**
 * How a match went for one of its clubs, as the Tabelle counts it: won, drawn or lost by its goals, a shoot-out
 * deciding nothing there, and `none` while it has no result, as a match called off or struck out never has, the
 * backend refusing one on either (`state_ergebnis_on_a_non_event`).
 */
export function outcomeFor(spiel: FLSpielJoined, teamId: string): Outcome {
  const tore = toreOf(spiel);
  if (tore === null) return "none";
  const [own, other] = spiel.team1?.team_id === teamId ? [tore.team1, tore.team2] : [tore.team2, tore.team1];
  return own > other ? "won" : own < other ? "lost" : "drawn";
}

function quelleWords(quelle: FLSpielQuelle | null): { short: Copy; long: Copy } | null {
  if (quelle === null) return null;
  const { quelle: words } = COPY.spielplan;
  if (quelle.type === "gruppe")
    return { short: words.gruppeShort(quelle.gruppe, quelle.platz), long: words.gruppe(quelle.gruppe, quelle.platz) };
  return quelle.ausgang === "sieger"
    ? { short: words.siegerShort(quelle.spiel_nr), long: words.sieger(quelle.spiel_nr) }
    : { short: words.verliererShort(quelle.spiel_nr), long: words.verlierer(quelle.spiel_nr) };
}

/** One side: the club and its plaque, or, while the draw has not settled it, where it comes from. */
function sideOf(team: FLSpielTeamFieldJoined | null, quelle: FLSpielQuelle | null): SpielSide {
  if (team !== null) return { name: { record: team.name }, plaque: { record: team.shorthand } };
  const words = quelleWords(quelle);
  return words === null
    ? { name: COPY.spielplan.quelle.open, plaque: { quelle: null } }
    : { name: words.long, plaque: { quelle: words.short } };
}

/** The match's two sides, the first-listed side first. */
export function sidesOf(spiel: Sides): { team1: SpielSide; team2: SpielSide } {
  return { team1: sideOf(spiel.team1, spiel.team1_quelle), team2: sideOf(spiel.team2, spiel.team2_quelle) };
}

/** The result as the kit's rows and heads take it, and nothing until one is entered. */
function resultOf(spiel: FLSpielJoined): Pick<SpielRowProps, "result"> {
  const tore = toreOf(spiel);
  if (tore === null) return {};
  return { result: { tore, ...(spiel.elfmeterschiessen === null ? {} : { elfmeterschiessen: spiel.elfmeterschiessen }) } };
}

/** When a match is played, as its row and its bracket card show it. */
export const whenOf = (spiel: Pick<FLSpielJoined, "datum" | "uhrzeit">): Copy => COPY.spielplan.when(dayOf(spiel.datum), timeOf(spiel.uhrzeit));

/**
 * A match as a row or a card of a match list, the whole of it a link to the match, which opens as the pop-up
 * over the page. The third-place match says so before its date, the one line every form of the row shows.
 */
export function matchRowOf(spiel: FLSpielJoined): SpielRowProps & { id: string } {
  const when = whenOf(spiel);
  return {
    id: spiel.id,
    href: ROUTES.spiel.path(spiel.saison_id, spiel.id),
    when: spiel.for_third_place ? SERVER_COPY.season.labelled(SERVER_COPY.season.thirdPlace, when) : when,
    ...sidesOf(spiel),
    ...resultOf(spiel),
  };
}

/** Where a group side stands, a link to its row of the Tabelle; a knockout side's round, a link to the match's card in the tree. */
function standingOf(spiel: FLSpielJoined, team: FLSpielTeamFieldJoined | null, standing: FLSpielSideStanding | null, round: Copy) {
  if (team === null) return undefined;
  if (spiel.saison_phase !== "gruppenphase") return { text: round, href: `${ROUTES.kORunde.path(spiel.saison_id)}#${spiel.id}` as Route };
  if (standing === null) return undefined;
  return {
    text: SERVER_COPY.season.standing(standing.platz, standing.gruppe),
    href: `${ROUTES.tabelle.path(spiel.saison_id)}#${team.team_id}` as Route,
  };
}

/**
 * The match's head, as its pop-up and its page show it: the matchday over the pairing and its score, each club's
 * name a link to its page and under it where it stands, a link to that place.
 */
export function headOf(spiel: FLSpielJoined, matchday: Matchday, standings: FLSpielSideStandings): SpielHeadProps {
  const { team1, team2 } = sidesOf(spiel);
  const eyebrow = matchdayOf(spiel, matchday);
  const side = (shown: SpielSide, team: FLSpielTeamFieldJoined | null, standing: FLSpielSideStanding | null) => ({
    ...shown,
    ...(team === null ? {} : { href: ROUTES.team.path(spiel.saison_id, team.team_id) }),
    ...(team === null ? {} : { standing: standingOf(spiel, team, standing, eyebrow) }),
  });
  return {
    eyebrow,
    team1: side(team1, spiel.team1, standings.team1),
    team2: side(team2, spiel.team2, standings.team2),
    ...resultOf(spiel),
  };
}

/**
 * The pop-up's facts under its head, each led by its glyph and each only where it holds a value: when and
 * where the match is played, and who referees it. The matchday stands in the head and the result in its
 * score, so neither is repeated here.
 */
export function popupFactsOf(spiel: FLSpielJoined): Fact[] {
  const { fact } = COPY.spielplan;
  const day = dayOf(spiel.datum);
  const time = timeOf(spiel.uhrzeit);
  const facts: (Fact | null)[] = [
    day === null ? null : { label: fact.datum, glyph: "calendar", value: { record: formatDatumWithWeekday(day) }, figures: true },
    time === null ? null : { label: fact.uhrzeit, glyph: "uhrzeit", value: { record: formatUhrzeit(time) }, figures: true },
    spiel.ort === null
      ? null
      : {
          label: fact.spielort,
          glyph: "spielorte",
          elsewhere: { href: buildMapsSearchUrl(spiel.ort.maps_link), label: { record: spiel.ort.name } },
        },
    spiel.schiedsrichter?.name == null
      ? null
      : { label: fact.schiedsrichter, glyph: "schiedsrichter", value: { record: spiel.schiedsrichter.name } },
  ];
  return facts.filter((each) => each !== null);
}

/** What befell a match in a visitor's words: a no-show names the side that did not turn up. */
function sonderereignisOf(sonderereignis: FLSonderereignis, spiel: Sides): Copy {
  const words = COPY.spielplan.sonderereignis;
  switch (sonderereignis) {
    case "nichtantreten_team1":
      return words.nichtAngetreten(sidesOf(spiel).team1.name);
    case "nichtantreten_team2":
      return words.nichtAngetreten(sidesOf(spiel).team2.name);
    default:
      return words[sonderereignis];
  }
}

/**
 * What befell the match, for the callout under its head: what happened, and under it what that means for the
 * result; `null` where the match is simply played. A no-show's consequence names the side that turned up.
 */
export function ereignisOf(spiel: Sides & Pick<FLSpielJoined, "sonderereignis" | "ergebnis">): { title: Copy; text: Copy } | null {
  const sonderereignis = spiel.sonderereignis;
  if (sonderereignis === null) return null;
  const title = sonderereignisOf(sonderereignis, spiel);
  const { consequence } = COPY.spielplan.sonderereignis;
  switch (sonderereignis) {
    case "nichtantreten_team1":
      return { title, text: consequence.nichtAngetreten(sidesOf(spiel).team2.name) };
    case "nichtantreten_team2":
      return { title, text: consequence.nichtAngetreten(sidesOf(spiel).team1.name) };
    case "abgebrochen":
      return { title, text: spiel.ergebnis === null ? consequence.abgebrochenOpen : consequence.abgebrochenScored };
    default:
      return { title, text: consequence[sonderereignis] };
  }
}
