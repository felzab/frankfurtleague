import { notFound } from "next/navigation";

import { COPY } from "@/core/copy";
import { formatDatum, formatUhrzeit } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SAISON_ID_LENGTH } from "@/features/saisons/constants";
import { getSaisons } from "@/features/saisons/queries";
import { SONDEREREIGNIS_LABELS } from "@/features/spiele/constants";
import { getSpiele } from "@/features/spiele/queries";
import { canStillBePlayed } from "@/features/spiele/utils";
import { getSpieltage } from "@/features/spieltage/queries";
import { spieltagLabels } from "@/features/spieltage/utils";
import { buildMapsSearchUrl } from "@/shared/utils/format";

import type { Copy } from "@/core/copy";
import type { Kalendertag, Paar, Uhrzeit } from "@/core/format";
import type { FLSaison } from "@/features/saisons/schemas";
import type { FLSpiel, FLSpielQuelle, FLSpielTeamFieldJoined } from "@/features/spiele/schemas";
import type { Fact } from "@/kit/Facts";
import type { MatchRowProps, MatchSide } from "@/kit/MatchRow";

/** The season an address names, among the seasons the public may read; any other is not found. */
export async function readSaison(saisonId: string): Promise<{ saison: FLSaison; saisons: readonly FLSaison[] }> {
  if (saisonId.length !== SAISON_ID_LENGTH) notFound();
  const { saisons } = await getSaisons();
  const saison = saisons.find((candidate) => candidate.id === saisonId);
  if (saison === undefined) notFound();
  return { saison, saisons };
}

/** The season button's entries: the Spielplan of every public season, the newest first, the one shown marked. */
export function seasonMenu(saison: FLSaison, saisons: readonly FLSaison[]) {
  return {
    current: COPY.shared.saisonName(saison.id),
    seasons: [...saisons]
      .sort((one, other) => other.id.localeCompare(one.id))
      .map((each) => ({ text: COPY.shared.saisonName(each.id), href: ROUTES.spielplan.pfad(each.id), isCurrent: each.id === saison.id })),
  };
}

/** One matchday as the Spielplan shows it: its name, and its matches in the order the draw numbered them. */
export type Matchday = { id: string; label: string; spiele: readonly FLSpiel[] };

/**
 * The season's matchdays in the order the season plays them, as the backend serves them, each holding its
 * matches; and the matchday the tabs open on.
 */
export async function readSpielplan(saison: FLSaison): Promise<{ matchdays: readonly Matchday[]; current: string | null }> {
  const [{ spieltage }, { spiele }] = await Promise.all([getSpieltage({ saison_id: saison.id }), getSpiele({ saison_id: saison.id })]);
  const labels = spieltagLabels(spieltage);
  const matchdays = spieltage.map((spieltag) => ({
    id: spieltag.id,
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
const tagOf = (datum: string | null): Kalendertag | null => (datum === null ? null : (datum as Kalendertag));
const zeitOf = (uhrzeit: string | null): Uhrzeit | null => (uhrzeit === null ? null : (uhrzeit as Uhrzeit));

/** The goals of a stored result „3:1“ as a pair, the first side's first. */
function toreOf(ergebnis: string): Paar {
  const [team1 = 0, team2 = 0] = ergebnis.split(":").map(Number);
  return { team1, team2 };
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
function sideOf(team: FLSpielTeamFieldJoined | null, quelle: FLSpielQuelle | null): MatchSide {
  if (team !== null) return { name: team.name, plaque: { kuerzel: team.shorthand } };
  const words = quelleWords(quelle);
  return words === null ? { name: COPY.spielplan.quelle.offen, plaque: { quelle: "" } } : { name: words.lang, plaque: { quelle: words.kurz } };
}

/** The match's two sides, the first-listed side first. */
export function sidesOf(spiel: FLSpiel): { heim: MatchSide; gast: MatchSide } {
  return { heim: sideOf(spiel.team1, spiel.team1_quelle), gast: sideOf(spiel.team2, spiel.team2_quelle) };
}

/** A match as a row of the Spielplan, the row opening the match's page. */
export function matchRowOf(spiel: FLSpiel): MatchRowProps & { id: string } {
  const { heim, gast } = sidesOf(spiel);
  return {
    id: spiel.id,
    href: ROUTES.spiel.pfad(spiel.saison_id, spiel.id),
    when: COPY.spielplan.wann(tagOf(spiel.datum), zeitOf(spiel.uhrzeit)),
    home: heim,
    away: gast,
    ...(spiel.ergebnis === null
      ? {}
      : {
          result: { tore: toreOf(spiel.ergebnis), ...(spiel.elfmeterschiessen === null ? {} : { elfmeterschiessen: spiel.elfmeterschiessen }) },
        }),
  };
}

/**
 * What the public read gives for one match, each fact only where it holds a value: the result and what
 * befell the match first, then when and where it is played.
 */
export function factsOf(spiel: FLSpiel, spieltag: string): Fact[] {
  const { fakt } = COPY.spielplan;
  const tag = tagOf(spiel.datum);
  const zeit = zeitOf(spiel.uhrzeit);
  const facts: (Fact | null)[] = [
    spiel.ergebnis === null
      ? null
      : { label: fakt.ergebnis, value: COPY.spielplan.ergebnis(toreOf(spiel.ergebnis), spiel.elfmeterschiessen), figures: true },
    spiel.sonderereignis === null ? null : { label: fakt.sonderereignis, value: SONDEREREIGNIS_LABELS[spiel.sonderereignis] },
    { label: fakt.spieltag, value: spieltag },
    tag === null ? null : { label: fakt.datum, value: formatDatum(tag), figures: true },
    zeit === null ? null : { label: fakt.uhrzeit, value: formatUhrzeit(zeit), figures: true },
    spiel.ort === null ? null : { label: fakt.ort, link: { href: buildMapsSearchUrl(spiel.ort.maps_link), text: spiel.ort.name } },
    spiel.schiedsrichter?.name == null ? null : { label: fakt.schiedsrichter, value: spiel.schiedsrichter.name },
    spiel.notiz === null || spiel.notiz.trim() === "" ? null : { label: fakt.notiz, value: spiel.notiz },
  ];
  return facts.filter((fact) => fact !== null);
}
