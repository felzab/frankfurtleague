import { COPY } from "@/core/copy";
import { formatDatum, formatUhrzeit } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { PHASE_LABELS } from "@/features/saisons/constants";
import { buildMapsSearchUrl } from "@/shared/utils/format";

import type { Copy } from "@/core/copy";
import type { CalendarDay, Pair, Uhrzeit } from "@/core/format";
import type {
  FLSonderereignis,
  FLSpielJoined,
  FLSpielQuelle,
  FLSpielSideStanding,
  FLSpielSideStandings,
  FLSpielTeamFieldJoined,
} from "@/core/generated/client/types";
import type { Fact } from "@/kit/Facts";
import type { SpielHeadProps } from "@/kit/SpielHead";
import type { SpielRowProps, SpielSide } from "@/kit/SpielRow";
import type { Route } from "next";

/**
 * A match as the kit's blocks show it, built once for every season page, the match page and the pop-up, the
 * landing's among them: its sides, its row, its head and its facts, from the public read's match.
 */

// The fixture's own strings, which its schema has already held to the stored formats.
const dayOf = (datum: string | null): CalendarDay | null => (datum === null ? null : (datum as CalendarDay));
const timeOf = (uhrzeit: string | null): Uhrzeit | null => (uhrzeit === null ? null : (uhrzeit as Uhrzeit));

/** The match between the two semi-finals' losers, as the read marks it: the one rule the podium reads too. */
export function isThirdPlace(spiel: Pick<FLSpielJoined, "for_third_place">): boolean {
  return spiel.for_third_place;
}

/**
 * What a matchday is called where the page names a single one: a group matchday by its number, a knockout one
 * by its round, the third-place match by its own name.
 */
export function matchdayOf(spiel: Pick<FLSpielJoined, "saison_phase" | "for_third_place">, position: number): string {
  if (isThirdPlace(spiel)) return SERVER_COPY.season.thirdPlace;
  return spiel.saison_phase === "gruppenphase" ? SERVER_COPY.season.spieltag(position) : PHASE_LABELS[spiel.saison_phase];
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
  if (team !== null) return { name: team.name, plaque: { kuerzel: team.shorthand } };
  const words = quelleWords(quelle);
  return words === null ? { name: COPY.spielplan.quelle.open, plaque: { quelle: "" } } : { name: words.long, plaque: { quelle: words.short } };
}

/** The match's two sides, the first-listed side first. */
export function sidesOf(spiel: FLSpielJoined): { heim: SpielSide; gast: SpielSide } {
  return { heim: sideOf(spiel.team1, spiel.team1_quelle), gast: sideOf(spiel.team2, spiel.team2_quelle) };
}

/** The result as the kit's rows and heads take it, and nothing until one is entered. */
function resultOf(spiel: FLSpielJoined): Pick<SpielRowProps, "result"> {
  const tore = toreOf(spiel);
  if (tore === null) return {};
  return { result: { tore, ...(spiel.elfmeterschiessen === null ? {} : { elfmeterschiessen: spiel.elfmeterschiessen }) } };
}

/** When a match is played, as its row and its bracket card show it. */
export const whenOf = (spiel: FLSpielJoined): string => COPY.spielplan.when(dayOf(spiel.datum), timeOf(spiel.uhrzeit));

/**
 * A match as a row or a card of a match list, the whole of it a link to the match, which opens as the pop-up
 * over the page. The third-place match says so before its date, the one line every form of the row shows.
 */
export function matchRowOf(spiel: FLSpielJoined): SpielRowProps & { id: string } {
  const { heim, gast } = sidesOf(spiel);
  const when = whenOf(spiel);
  return {
    id: spiel.id,
    href: ROUTES.spiel.path(spiel.saison_id, spiel.id),
    when: isThirdPlace(spiel) ? SERVER_COPY.season.labelled(SERVER_COPY.season.thirdPlace, when) : when,
    home: heim,
    away: gast,
    ...resultOf(spiel),
  };
}

/** Where a group side stands, a link to its row of the Tabelle; a knockout side's round, a link to the match's card in the tree. */
function standingOf(spiel: FLSpielJoined, team: FLSpielTeamFieldJoined | null, standing: FLSpielSideStanding | null, round: string) {
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
export function headOf(spiel: FLSpielJoined, position: number, standings: FLSpielSideStandings): SpielHeadProps {
  const { heim, gast } = sidesOf(spiel);
  const eyebrow = matchdayOf(spiel, position);
  const side = (shown: SpielSide, team: FLSpielTeamFieldJoined | null, standing: FLSpielSideStanding | null) => ({
    ...shown,
    ...(team === null ? {} : { href: ROUTES.team.path(spiel.saison_id, team.team_id) }),
    ...(team === null ? {} : { standing: standingOf(spiel, team, standing, eyebrow) }),
  });
  return {
    eyebrow,
    home: side(heim, spiel.team1, standings.team1),
    away: side(gast, spiel.team2, standings.team2),
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
    day === null ? null : { label: fact.datum, glyph: "calendar", value: formatDatum(day), figures: true },
    time === null ? null : { label: fact.uhrzeit, glyph: "uhrzeit", value: formatUhrzeit(time), figures: true },
    spiel.ort === null
      ? null
      : { label: fact.spielort, glyph: "spielorte", elsewhere: { href: buildMapsSearchUrl(spiel.ort.maps_link), text: spiel.ort.name } },
    spiel.schiedsrichter?.name == null ? null : { label: fact.schiedsrichter, glyph: "schiedsrichter", value: spiel.schiedsrichter.name },
  ];
  return facts.filter((each) => each !== null);
}

/** What befell a match in a visitor's words: a no-show names the side that did not turn up. */
function sonderereignisOf(ereignis: FLSonderereignis, spiel: FLSpielJoined): Copy {
  const words = COPY.spielplan.sonderereignis;
  switch (ereignis) {
    case "nichtantreten_team1":
      return words.nichtAngetreten(sidesOf(spiel).heim.name);
    case "nichtantreten_team2":
      return words.nichtAngetreten(sidesOf(spiel).gast.name);
    default:
      return words[ereignis];
  }
}

/**
 * What befell the match, for the callout under its head: what happened, and under it what that means for the
 * result; `null` where the match is simply played. A no-show's consequence names the side that turned up.
 */
export function ereignisOf(spiel: FLSpielJoined): { title: Copy; text: Copy } | null {
  const ereignis = spiel.sonderereignis;
  if (ereignis === null) return null;
  const title = sonderereignisOf(ereignis, spiel);
  const { consequence } = COPY.spielplan.sonderereignis;
  switch (ereignis) {
    case "nichtantreten_team1":
      return { title, text: consequence.nichtAngetreten(sidesOf(spiel).gast.name) };
    case "nichtantreten_team2":
      return { title, text: consequence.nichtAngetreten(sidesOf(spiel).heim.name) };
    case "abgebrochen":
      return { title, text: spiel.ergebnis === null ? consequence.abgebrochenOpen : consequence.abgebrochenScored };
    default:
      return { title, text: consequence[ereignis] };
  }
}
