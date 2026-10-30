import { notFound } from "next/navigation";
import { connection } from "next/server";

import { COPY } from "@/core/copy";
import { formatDatum, formatPeriod, formatUhrzeit } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SAISON_ID_LENGTH } from "@/features/saisons/constants";
import { getSaisons } from "@/features/saisons/queries";
import { selectSaison } from "@/features/saisons/resolvers";
import { getSpiele } from "@/features/spiele/queries";
import { canStillBePlayed } from "@/features/spiele/utils";
import { getSpieltage } from "@/features/spieltage/queries";
import { spieltagLabels } from "@/features/spieltage/utils";
import { buildMapsSearchUrl } from "@/shared/utils/format";

import type { Copy } from "@/core/copy";
import type { CalendarDay, Paar, Uhrzeit } from "@/core/format";
import type { FLSaison, FLSonderereignis, FLSpielQuelle, FLSpielTeamFieldJoined } from "@/core/generated/client/types";
import type { FLSpiel } from "@/features/spiele/types";
import type { Fact } from "@/kit/Facts";
import type { Saisons } from "@/kit/FrameNav";
import type { SpielHeadProps } from "@/kit/MatchHead";
import type { SpielRowProps, SpielSide } from "@/kit/MatchRow";

/** The season an address names, among the seasons the public may read; any other is not found. */
export async function readSaison(saisonId: string): Promise<{ saison: FLSaison }> {
  if (saisonId.length !== SAISON_ID_LENGTH) notFound();
  const { saisons } = await getSaisons();
  const saison = saisons.find((candidate) => candidate.id === saisonId);
  if (saison === undefined) notFound();
  return { saison };
}

/**
 * The season button's seasons: every public season, the newest first; `null` where the public may read none.
 * Read at request time, so the frame's prerendered shell holds none: the image's build reaches no backend.
 */
export async function readSeasons(): Promise<Saisons | null> {
  await connection();
  const { saisons } = await getSaisons();
  const standard = selectSaison(saisons, undefined);
  if (standard === undefined) return null;
  return {
    entries: saisons
      // The season's own strings, which its schema has already held to the stored format.
      .map((saison) => ({ id: saison.id, span: formatPeriod(saison.start_date as CalendarDay, saison.end_date as CalendarDay) }))
      .sort((one, other) => other.id.localeCompare(one.id)),
    standard: standard.id,
  };
}

/**
 * One matchday as the Spielplan shows it: its name, and its matches in the order the draw numbered them.
 * `key` is what the address calls it, `?tab=<phase>-<position>` such as `gruppenphase-3` or `finale-1`: its
 * stored phase and stored position, unique together within a season and not alone, since `position`
 * restarts at 1 in every phase. It carries no database id, so the address reads.
 */
export type Matchday = { id: string; key: string; label: string; spiele: readonly FLSpiel[] };

/**
 * The season's matchdays in the order the season plays them, as the backend serves them, each holding its
 * matches; and the matchday the tabs open on.
 */
export async function readSpielplan(saison: FLSaison): Promise<{ matchdays: readonly Matchday[]; current: string | null }> {
  const [{ spieltage }, { spiele }] = await Promise.all([getSpieltage({ saison_id: saison.id }), getSpiele({ saison_id: saison.id })]);
  const labels = spieltagLabels(spieltage);
  const matchdays = spieltage.map((spieltag) => ({
    id: spieltag.id,
    key: `${spieltag.saison_phase}-${String(spieltag.position)}`,
    label: labels.get(spieltag.id)?.label ?? "",
    spiele: spiele.filter((spiel) => spiel.spieltag_id === spieltag.id).sort((one, other) => one.spiel_nr - other.spiel_nr),
  }));
  return { matchdays, current: currentMatchday(matchdays, saison.status === "past") };
}

/**
 * The matchday most likely wanted: the first that holds a match still to be played, else the last. The
 * season read does not serve it yet, so it is derived here from the matches the Spielplan reads anyway.
 */
export function currentMatchday(matchdays: readonly Matchday[], isFinishedSaison: boolean): string | null {
  const next = matchdays.find((matchday) => matchday.spiele.some((spiel) => canStillBePlayed(spiel, isFinishedSaison)));
  return (next ?? matchdays.at(-1))?.id ?? null;
}

/** One match of the season, with its matchday's name, or not found. */
export async function readSpiel(saison: FLSaison, spielId: string): Promise<{ spiel: FLSpiel; spieltag: string }> {
  const { matchdays } = await readSpielplan(saison);
  for (const matchday of matchdays) {
    const spiel = matchday.spiele.find((candidate) => candidate.id === spielId);
    if (spiel !== undefined) return { spiel, spieltag: matchday.label };
  }
  notFound();
}

// The fixture's own strings, which its schema has already held to the stored formats.
const tagOf = (datum: string | null): CalendarDay | null => (datum === null ? null : (datum as CalendarDay));
const zeitOf = (uhrzeit: string | null): Uhrzeit | null => (uhrzeit === null ? null : (uhrzeit as Uhrzeit));

/**
 * A played match's goals, the first side's first, as each side carries them: the backend writes
 * `ergebnis` from these and reads it only as the mark that the match was played. A hand edit holding
 * `ergebnis` without both sides' goals shows no result, as the bracket counts none.
 */
function toreOf(spiel: FLSpiel): Paar | null {
  const team1 = spiel.team1?.tore ?? null;
  const team2 = spiel.team2?.tore ?? null;
  return spiel.ergebnis === null || team1 === null || team2 === null ? null : { team1, team2 };
}

function quelleWords(quelle: FLSpielQuelle | null): { kurz: Copy; lang: Copy } | null {
  if (quelle === null) return null;
  const { quelle: words } = COPY.spielplan;
  if (quelle.type === "gruppe") return { kurz: words.gruppeKurz(quelle.gruppe, quelle.platz), lang: words.gruppe(quelle.gruppe, quelle.platz) };
  return quelle.ausgang === "sieger"
    ? { kurz: words.siegerKurz(quelle.spiel_nr), lang: words.sieger(quelle.spiel_nr) }
    : { kurz: words.verliererKurz(quelle.spiel_nr), lang: words.verlierer(quelle.spiel_nr) };
}

/** One side: the club and its plaque, or, while the draw has not settled it, where it comes from. */
function sideOf(team: FLSpielTeamFieldJoined | null, quelle: FLSpielQuelle | null): SpielSide {
  if (team !== null) return { name: team.name, plaque: { kuerzel: team.shorthand } };
  const words = quelleWords(quelle);
  return words === null ? { name: COPY.spielplan.quelle.offen, plaque: { quelle: "" } } : { name: words.lang, plaque: { quelle: words.kurz } };
}

/** The match's two sides, the first-listed side first. */
export function sidesOf(spiel: FLSpiel): { heim: SpielSide; gast: SpielSide } {
  return { heim: sideOf(spiel.team1, spiel.team1_quelle), gast: sideOf(spiel.team2, spiel.team2_quelle) };
}

/** The result as the kit's rows and heads take it, and nothing until one is entered. */
function resultOf(spiel: FLSpiel): Pick<SpielRowProps, "result"> {
  const tore = toreOf(spiel);
  if (tore === null) return {};
  return { result: { tore, ...(spiel.elfmeterschiessen === null ? {} : { elfmeterschiessen: spiel.elfmeterschiessen }) } };
}

/** A match as a row of the Spielplan, the row opening the match's page. */
export function matchRowOf(spiel: FLSpiel): SpielRowProps & { id: string } {
  const { heim, gast } = sidesOf(spiel);
  return {
    id: spiel.id,
    href: ROUTES.spiel.path(spiel.saison_id, spiel.id),
    when: COPY.spielplan.wann(tagOf(spiel.datum), zeitOf(spiel.uhrzeit)),
    home: heim,
    away: gast,
    ...resultOf(spiel),
  };
}

/** The pop-up's head: the matchday over the pairing and its score. */
export function headOf(spiel: FLSpiel, spieltag: string): SpielHeadProps {
  const { heim, gast } = sidesOf(spiel);
  return { eyebrow: spieltag, home: heim, away: gast, ...resultOf(spiel) };
}

/**
 * The pop-up's facts under its head, each led by its glyph and each only where it holds a value: when and
 * where the match is played, and who referees it. The matchday stands in the head and the result in its
 * score, so neither is repeated here.
 */
export function popupFactsOf(spiel: FLSpiel): Fact[] {
  const { fakt } = COPY.spielplan;
  const tag = tagOf(spiel.datum);
  const zeit = zeitOf(spiel.uhrzeit);
  const facts: (Fact | null)[] = [
    tag === null ? null : { label: fakt.datum, glyph: "kalender", value: formatDatum(tag), figures: true },
    zeit === null ? null : { label: fakt.uhrzeit, glyph: "uhrzeit", value: formatUhrzeit(zeit), figures: true },
    spiel.ort === null
      ? null
      : { label: fakt.ort, glyph: "spielorte", elsewhere: { href: buildMapsSearchUrl(spiel.ort.maps_link), text: spiel.ort.name } },
    spiel.schiedsrichter?.name == null ? null : { label: fakt.schiedsrichter, glyph: "schiedsrichter", value: spiel.schiedsrichter.name },
  ];
  return facts.filter((fact) => fact !== null);
}

/** What befell a match in a visitor's words: a no-show names the side that did not turn up. */
function sonderereignisOf(ereignis: FLSonderereignis, spiel: FLSpiel): Copy {
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
 * What befell the match, for the pop-up's callout: what happened, and under it what that means for the
 * result; `null` where the match is simply played. A no-show's consequence names the side that turned up.
 */
export function ereignisOf(spiel: FLSpiel): { title: Copy; text: Copy } | null {
  const ereignis = spiel.sonderereignis;
  if (ereignis === null) return null;
  const title = sonderereignisOf(ereignis, spiel);
  const { folge } = COPY.spielplan.sonderereignis;
  switch (ereignis) {
    case "nichtantreten_team1":
      return { title, text: folge.nichtAngetreten(sidesOf(spiel).gast.name) };
    case "nichtantreten_team2":
      return { title, text: folge.nichtAngetreten(sidesOf(spiel).heim.name) };
    case "abgebrochen":
      return { title, text: spiel.ergebnis === null ? folge.abgebrochenOffen : folge.abgebrochenGewertet };
    default:
      return { title, text: folge[ereignis] };
  }
}

/**
 * What the public read gives for one match, each fact only where it holds a value: the result and what
 * befell the match first, then when and where it is played.
 */
export function factsOf(spiel: FLSpiel, spieltag: string): Fact[] {
  const { fakt } = COPY.spielplan;
  const tag = tagOf(spiel.datum);
  const zeit = zeitOf(spiel.uhrzeit);
  const tore = toreOf(spiel);
  const facts: (Fact | null)[] = [
    tore === null ? null : { label: fakt.ergebnis, value: COPY.spielplan.ergebnis(tore, spiel.elfmeterschiessen), figures: true },
    spiel.sonderereignis === null ? null : { label: fakt.sonderereignis, value: sonderereignisOf(spiel.sonderereignis, spiel) },
    { label: fakt.spieltag, value: spieltag },
    tag === null ? null : { label: fakt.datum, value: formatDatum(tag), figures: true },
    zeit === null ? null : { label: fakt.uhrzeit, value: formatUhrzeit(zeit), figures: true },
    spiel.ort === null ? null : { label: fakt.ort, elsewhere: { href: buildMapsSearchUrl(spiel.ort.maps_link), text: spiel.ort.name } },
    spiel.schiedsrichter?.name == null ? null : { label: fakt.schiedsrichter, value: spiel.schiedsrichter.name },
    spiel.notiz === null || spiel.notiz.trim() === "" ? null : { label: fakt.notiz, value: spiel.notiz },
  ];
  return facts.filter((fact) => fact !== null);
}
