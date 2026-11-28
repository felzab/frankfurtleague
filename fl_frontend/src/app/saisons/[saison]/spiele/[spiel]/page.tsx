import { notFound } from "next/navigation";

import { COPY } from "@/core/copy/shared";
import { dayOf, formatDateWithWeekday, formatErgebnis, formatOrdinal, formatTime, formatYear, timeOf } from "@/core/format";
import { buildMapsSearchUrl } from "@/core/maps";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getSpielPage } from "@/features/saisons/queries";
import { publicSaisonOf } from "@/features/saisons/resolvers";
import { eventOf, headOf, matchdayOf, refereeOf, sidesOf } from "@/features/spiele/blocks";
import { byMinute, creditedSide } from "@/features/spiele/result";
import { publicPupilHead, publicPupilRow, spielerName } from "@/features/spieler/constants";
import { ReadFolds } from "@/kit/ReadFolds";
import { ReadPage } from "@/kit/ReadPage";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";
import { objectIdParamOf } from "@/shared/utils/routeParams";

import type { Copy } from "@/core/copy";
import type { CalendarDay } from "@/core/format";
import type {
  FLAufstellungEntryPublic,
  FLAufstellungPublic,
  FLSonderereignis,
  FLSpielberichtCardPublic,
  FLSpielberichtScorerPublic,
  FLSpielJoined,
  FLSpielPageResponse,
} from "@/core/generated/client/types";
import type { FoldedCard } from "@/kit/ReadFolds";
import type { ReadRecord } from "@/kit/ReadPage";
import type { StatTile } from "@/kit/StatTiles";
import type { TableProps } from "@/kit/Table";
import type { Checkpoint } from "@/kit/Timeline";
import type { Metadata } from "next";

type Props = PageProps<"/saisons/[saison]/spiele/[spiel]">;

/** The match the address names, or `null` for a malformed id, a season the public may not read, or no such match. */
async function findPage(params: Props["params"]): Promise<FLSpielPageResponse | null> {
  const spiel = await objectIdParamOf(params, "spiel");
  const saison = await publicSaisonOf(params);
  return spiel === null || saison === null ? null : getSpielPage(saison, spiel);
}

async function readPage(params: Props["params"]): Promise<FLSpielPageResponse> {
  const page = await findPage(params);
  if (page === null) notFound();
  return page;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataFor(findPage(params), ({ spiel }) => {
    const { team1, team2 } = sidesOf(spiel);
    return pageMetadata(ROUTES.spiel, ROUTES.spiel.path(spiel.saison_id, spiel.id), {
      title: ROUTES.spiel.title(team1.name, team2.name),
      description: SERVER_COPY.description.spiel(team1.name, team2.name, spiel.saison_id),
    });
  });
}

/**
 * A match's own page, on a direct load, a reload or „Zum Spiel“: its head, its five facts as tiles, the line-ups
 * folded side by side, and its goals and cards along the dotted line, each of the last two only where the match can
 * have it (`drawn`), the goals and cards also wherever the read serves one. Opened from a match card, the pop-up shows
 * instead.
 */
export default function SpielPage({ params }: Props) {
  return (
    <ReadPage
      scope="saison"
      record={readRecord(params)}
    />
  );
}

async function readRecord(params: Props["params"]): Promise<ReadRecord> {
  const page = await readPage(params);
  const { spiel, standings, aufstellungen, bericht } = page;
  const { team1, team2 } = sidesOf(spiel);
  const words = SERVER_COPY.season.spiel;
  // The goals and cards as official: null until the report is adopted and where none is stored, so a result
  // awaiting its report never reads as nobody having scored, which an adopted report's empty lists say.
  const official = bericht?.scorers == null || bericht.cards === null ? null : { tore: bericht.scorers, cards: bericht.cards };
  const events = official === null ? [] : eventsOf(spiel, official.tore, official.cards);
  const lineupHeld = [aufstellungen.team1, aufstellungen.team2].some((aufstellung) => (aufstellung?.spieler.length ?? 0) > 0);
  return {
    title: { route: "spiel", team1: team1.name, team2: team2.name },
    spiel: { head: headOf(spiel, page, standings), sonderereignis: eventOf(spiel) },
    groups: [
      { kind: "tiles", tiles: { layout: "five", items: tilesOf(spiel, page) } },
      ...(drawn(spiel.sonderereignis, lineupHeld)
        ? [
            {
              title: words.aufstellung,
              kind: "folds" as const,
              folds: (
                <ReadFolds
                  cards={[
                    { title: team1.name, ...lineupOf(aufstellungen.team1) },
                    { title: team2.name, ...lineupOf(aufstellungen.team2) },
                  ]}
                />
              ),
            },
          ]
        : []),
      // Wherever the read serves an event too: a forfeit's adopted report may carry cards.
      ...(drawn(spiel.sonderereignis, false) || events.length > 0
        ? [
            {
              title: words.toreAndCards,
              kind: "timeline" as const,
              label: words.toreAndCards,
              items: events,
              empty: { kind: "none" as const, plural: official === null ? words.officialToreAndCards : words.toreAndCards },
            },
          ]
        : []),
    ],
  };
}

/**
 * Whether the match can have what a section shows, by what befell it: a match called off or forfeited was never
 * played, so it holds no line-up; an abandoned one keeps what it reached; an annulled one may have been played, so it
 * keeps a section that `holds` something and leaves out an empty one. The goals and cards stand besides wherever the
 * read serves one: a forfeit's adopted report may carry cards, while the read serves none on a match called off or
 * annulled.
 */
function drawn(sonderereignis: FLSonderereignis | null, holds: boolean): boolean {
  switch (sonderereignis) {
    case null:
    case "abgebrochen":
      return true;
    case "annulliert":
      return holds;
    case "ausgefallen":
    case "nichtantreten_team1":
    case "nichtantreten_team2":
      return false;
  }
}

/**
 * The match's five facts, a tile each, an absent one a dash: its matchday, a group matchday by its number over its
 * phase; its date, as a match row writes it, over its year; its time; its referee; its venue.
 */
function tilesOf(spiel: FLSpielJoined, page: FLSpielPageResponse): readonly [StatTile, StatTile, StatTile, StatTile, StatTile] {
  const { fact } = COPY.spielplan;
  const group = spiel.saison_phase === "gruppenphase";
  return [
    group
      ? { label: fact.spieltag, value: { record: formatOrdinal(page.spieltag_position) }, line: COPY.shared.phase.gruppenphase }
      : { label: fact.spieltag, value: matchdayOf(spiel, page), words: true },
    dateTileOf(spiel.date === null ? null : dayOf(spiel.date)),
    { label: fact.time, value: spiel.time === null ? COPY.shared.noValue : { record: formatTime(timeOf(spiel.time)) } },
    { label: fact.schiedsrichter, value: refereeOf(spiel), words: true },
    spiel.spielort === null
      ? { label: fact.spielort, value: COPY.shared.noValue, words: true }
      : { label: fact.spielort, value: { record: spiel.spielort.name }, words: true, href: buildMapsSearchUrl(spiel.spielort.maps_query) },
  ];
}

/**
 * The date's tile: the day as a match row writes it, „Mi., 28.10.“, over its year, so the tile is no wider than a fifth
 * of the column, as the Spieltag's number stands over its phase.
 */
function dateTileOf(day: CalendarDay | null): StatTile {
  const { date } = COPY.spielplan.fact;
  return day === null
    ? { label: date, value: COPY.shared.noValue }
    : { label: date, value: { record: formatDateWithWeekday(day) }, line: { record: formatYear(day) } };
}

/** A line-up's pupils as one table: a row a pupil, as every public pupils' table sets one. */
function tableOf(label: Copy, spieler: readonly FLAufstellungEntryPublic[]): TableProps {
  const { column, spiel } = SERVER_COPY.season;
  return {
    label,
    ...publicPupilHead(column),
    rows: spieler.map((entry, index) => ({ id: String(index), ...publicPupilRow(entry) })),
    empty: { kind: "none", plural: spiel.aufstellung },
  };
}

/**
 * One side's line-up as its folded card holds it: the starters, then the bench, each under its head and left out
 * where it holds nobody; a side with no line-up says so.
 */
function lineupOf(aufstellung: FLAufstellungPublic | null): Pick<FoldedCard, "count" | "tables"> {
  const none = { tables: [tableOf(SERVER_COPY.season.spiel.aufstellung, [])] } as const;
  if (aufstellung === null || aufstellung.spieler.length === 0) return none;
  const { startelf, bank } = COPY.shared;
  const parts = [
    { head: startelf, spieler: aufstellung.spieler.filter((entry) => entry.starts) },
    { head: bank, spieler: aufstellung.spieler.filter((entry) => !entry.starts) },
  ].filter((part) => part.spieler.length > 0);
  return {
    count: aufstellung.spieler.length,
    tables: parts.map((part) => ({ head: part.head, table: tableOf(part.head, part.spieler) })),
  };
}

/**
 * The goals and cards by minute, a checkpoint each: what happened and to whom, the side's Kürzel, and after a goal
 * the score it made. An own goal counts for the other side.
 */
function eventsOf(spiel: FLSpielJoined, tore: readonly FLSpielberichtScorerPublic[], cards: readonly FLSpielberichtCardPublic[]): Checkpoint[] {
  const words = SERVER_COPY.season.spiel;
  const shorthand = { team1: { record: spiel.team1?.shorthand ?? "" }, team2: { record: spiel.team2?.shorthand ?? "" } };
  const events = [
    ...tore.map((tor) => ({ kind: "tor" as const, minute: tor.minute, tor })),
    ...cards.map((card) => ({ kind: "card" as const, minute: card.minute, card })),
  ].sort((one, other) => byMinute(one.minute, other.minute));
  const score = { team1: 0, team2: 0 };
  return events.map((event, index) => {
    if (event.kind === "card") {
      const { card } = event;
      return {
        id: `k${String(index)}`,
        point: { record: card.minute },
        mark: { colour: card.colour },
        title: words.event(words.card[card.colour], spielerName(card.spieler)),
        detail: shorthand[card.side],
      };
    }
    const { tor } = event;
    score[creditedSide(tor)] += 1;
    return {
      id: `t${String(index)}`,
      point: { record: tor.minute },
      title: words.event(tor.eigentor ? words.eigentor : words.tor, spielerName(tor.spieler)),
      detail: SERVER_COPY.season.labelled(shorthand[tor.side], { record: formatErgebnis(score) }),
    };
  });
}
