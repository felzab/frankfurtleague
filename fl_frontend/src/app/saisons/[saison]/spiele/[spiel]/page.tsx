import { notFound } from "next/navigation";

import { ReadFolds, ReadFoldsPlaceholder } from "@/kit/ReadFolds";
import { ReadPage } from "@/kit/ReadPage";

import { COPY } from "@/core/copy";
import { dayOf, formatDateWithWeekday, formatErgebnis, formatOrdinal, formatTime, timeOf } from "@/core/format";
import { buildMapsSearchUrl } from "@/core/maps";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { PHASE_LABELS } from "@/features/saisons/constants";
import { getSpielPage } from "@/features/saisons/queries";
import { publicSaisonOf } from "@/features/saisons/resolvers";
import { eventOf, headOf, matchdayOf, refereeOf, sidesOf } from "@/features/spiele/blocks";
import { creditedSide } from "@/features/spiele/result";
import { roleMarkOf, spielerName } from "@/features/spieler/constants";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";
import { objectIdParamOf } from "@/shared/utils/routeParams";

import type { Copy } from "@/core/copy";
import type { CalendarDay } from "@/core/format";
import type {
  FLAufstellungEntryPublic,
  FLAufstellungPublic,
  FLSpielberichtCardPublic,
  FLSpielberichtScorerPublic,
  FLSpielJoined,
  FLSpielPageResponse,
} from "@/core/generated/client/types";
import type { FoldedCard } from "@/kit/ReadFolds";
import type { ReadRecord } from "@/kit/ReadPage";
import type { StatTile } from "@/kit/StatTiles";
import type { TableProps, TableRow } from "@/kit/Table";
import type { Checkpoint } from "@/kit/Timeline";
import type { Metadata, ResolvingMetadata } from "next";

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

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  return metadataFor(findPage(params), ({ spiel }) => {
    const { team1, team2 } = sidesOf(spiel);
    return pageMetadata(parent, ROUTES.spiel, ROUTES.spiel.path(spiel.saison_id, spiel.id), {
      title: ROUTES.spiel.title(team1.name, team2.name),
      description: SERVER_COPY.description.spiel(team1.name, team2.name, spiel.saison_id),
    });
  });
}

/**
 * A match's own page, on a direct load, a reload or „Zum Spiel“: its head, its five facts as tiles, the line-ups
 * folded side by side, and its goals and cards along the dotted line. Opened from a match card, the pop-up shows
 * instead (`app/@modal/(.)saisons/[saison]/spiele/[spiel]`).
 */
export default function SpielPage({ params }: Props) {
  return (
    <ReadPage
      scope="saison"
      wait={{
        spiel: true,
        groups: [
          { kind: "tiles", layout: "five" },
          { title: SERVER_COPY.season.spiel.aufstellung, kind: "folds", folds: <ReadFoldsPlaceholder count={2} /> },
          { title: SERVER_COPY.season.spiel.toreAndCards, kind: "timeline", count: 3 },
        ],
      }}
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
  return {
    title: { route: "spiel", team1: team1.name, team2: team2.name },
    spiel: { head: headOf(spiel, page, standings), sonderereignis: eventOf(spiel) },
    groups: [
      { kind: "tiles", tiles: { layout: "five", items: tilesOf(spiel, page) } },
      {
        title: words.aufstellung,
        kind: "folds",
        folds: (
          <ReadFolds
            cards={[
              { title: team1.name, ...lineupOf(aufstellungen.team1) },
              { title: team2.name, ...lineupOf(aufstellungen.team2) },
            ]}
          />
        ),
      },
      {
        title: words.toreAndCards,
        kind: "timeline",
        label: words.toreAndCards,
        items: official === null ? [] : eventsOf(spiel, official.tore, official.cards),
        empty: { kind: "none", plural: official === null ? words.officialToreAndCards : words.toreAndCards },
      },
    ],
  };
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
      ? { label: fact.spieltag, value: { record: formatOrdinal(page.spieltag_position) }, line: PHASE_LABELS.gruppenphase }
      : { label: fact.spieltag, value: matchdayOf(spiel, page), words: true },
    dateTileOf(spiel.date === null ? null : dayOf(spiel.date)),
    { label: fact.time, value: spiel.time === null ? COPY.shared.noValue : { record: formatTime(timeOf(spiel.time)) } },
    { label: fact.schiedsrichter, value: refereeOf(spiel), words: true },
    spiel.spielort === null
      ? { label: fact.spielort, value: COPY.shared.noValue, words: true }
      : { label: fact.spielort, value: { record: spiel.spielort.name }, words: true, href: buildMapsSearchUrl(spiel.spielort.maps_link) },
  ];
}

/**
 * The date's tile: the day as a match row writes it, „Mi., 28.10.“, over its year, so the tile is no wider than a fifth
 * of the column (`kit/StatTiles.tsx`'s `five`), as the Spieltag's number stands over its phase.
 */
function dateTileOf(day: CalendarDay | null): StatTile {
  const { date } = COPY.spielplan.fact;
  // A stored day's first four characters are its year, as a German date writes it.
  return day === null
    ? { label: date, value: COPY.shared.noValue }
    : { label: date, value: { record: formatDateWithWeekday(day) }, line: { record: day.slice(0, 4) } };
}

/** A line-up's pupil as their row names them: the captain's or the Co-Kapitän's mark after a published name, never after „anonym“. */
function rowNameOf(entry: FLAufstellungEntryPublic): Pick<TableRow, "name" | "mark"> {
  const name = spielerName(entry);
  const mark = typeof name === "string" ? undefined : roleMarkOf(entry.rolle);
  return mark === undefined ? { name } : { name, mark };
}

/** A line-up's pupils as one table: a row a pupil, with their number and position. */
function tableOf(label: Copy, spieler: readonly FLAufstellungEntryPublic[]): TableProps {
  const { column, spiel } = SERVER_COPY.season;
  return {
    label,
    nameLabel: column.name,
    columns: [
      { key: "nummer", label: column.nummer, figures: true },
      { key: "position", label: column.position, width: "word" },
    ],
    rows: spieler.map((entry, index) => ({
      id: String(index),
      ...rowNameOf(entry),
      cells: {
        ...(entry.nummer === null ? {} : { nummer: { record: entry.nummer } }),
        ...(entry.position === null ? {} : { position: { record: entry.position } }),
      },
    })),
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

/** A minute as the report writes it, „45+2“, in the order it was played. */
const minuteOf = (minute: string): [number, number] => {
  const [base = "0", added = "0"] = minute.split("+");
  return [Number(base), Number(added)];
};
const earlier = (one: string, other: string) => {
  const [a, b] = [minuteOf(one), minuteOf(other)];
  return a[0] - b[0] || a[1] - b[1];
};

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
  ].sort((one, other) => earlier(one.minute, other.minute));
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
