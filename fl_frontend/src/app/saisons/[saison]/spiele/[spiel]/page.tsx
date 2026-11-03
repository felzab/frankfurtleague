import { notFound } from "next/navigation";

import { ReadFolds } from "@/kit/ReadFolds";
import { ReadPage } from "@/kit/ReadPage";

import { COPY } from "@/core/copy";
import { formatDatumPair, formatErgebnis, formatOrdinal, formatUhrzeit } from "@/core/format";
import { buildMapsSearchUrl } from "@/core/maps";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { PHASE_LABELS } from "@/features/saisons/constants";
import { getSpielPage } from "@/features/saisons/queries";
import { resolvePublicSaisonParam } from "@/features/saisons/resolvers";
import { ereignisOf, headOf, matchdayOf, sidesOf } from "@/features/spiele/blocks";
import { pageMetadata } from "@/shared/utils/metadata";
import { resolveObjectIdParam } from "@/shared/utils/routeParams";

import type { Copy, Words } from "@/core/copy";
import type { CalendarDay, Uhrzeit } from "@/core/format";
import type {
  FLAufstellungEntryPublic,
  FLAufstellungPublic,
  FLSpielberichtKartePublic,
  FLSpielberichtSpielerPublic,
  FLSpielberichtTorPublic,
  FLSpielJoined,
  FLSpielPageResponse,
} from "@/core/generated/client/types";
import type { FoldedCard } from "@/kit/ReadFolds";
import type { ReadRecord } from "@/kit/ReadPage";
import type { StatTile } from "@/kit/StatTiles";
import type { TableProps } from "@/kit/Table";
import type { Checkpoint } from "@/kit/Timeline";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/saisons/[saison]/spiele/[spiel]">;

async function readPage(params: Props["params"]): Promise<FLSpielPageResponse> {
  const spiel = await resolveObjectIdParam(params, "spiel");
  const page = await getSpielPage(await resolvePublicSaisonParam(params), spiel);
  if (page === null) notFound();
  return page;
}

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const { spiel } = await readPage(params);
  const { team1, team2 } = sidesOf(spiel);
  return pageMetadata(parent, ROUTES.spiel, ROUTES.spiel.path(spiel.saison_id, spiel.id), {
    title: ROUTES.spiel.title(team1.name, team2.name),
    description: SERVER_COPY.description.spiel(team1.name, team2.name, spiel.saison_id),
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
      record={readRecord(params)}
    />
  );
}

async function readRecord(params: Props["params"]): Promise<ReadRecord> {
  const page = await readPage(params);
  const { spiel, standings, bericht } = page;
  const { team1, team2 } = sidesOf(spiel);
  const words = SERVER_COPY.season.spiel;
  // The goals and cards as official: null until the report is adopted and where none is stored, so a result
  // awaiting its report never reads as nobody having scored, which an adopted report's empty lists say.
  const official = bericht?.torschuetzen == null || bericht.karten === null ? null : { tore: bericht.torschuetzen, karten: bericht.karten };
  return {
    title: { route: "spiel", team1: team1.name, team2: team2.name },
    spiel: { head: headOf(spiel, page, standings), sonderereignis: ereignisOf(spiel) },
    groups: [
      { kind: "tiles", tiles: { layout: "five", items: tilesOf(spiel, page) } },
      {
        title: words.aufstellung,
        kind: "folds",
        folds: (
          <ReadFolds
            cards={[
              { title: team1.name, ...lineupOf(bericht?.aufstellungen.team1 ?? null) },
              { title: team2.name, ...lineupOf(bericht?.aufstellungen.team2 ?? null) },
            ]}
          />
        ),
      },
      {
        title: words.toreUndKarten,
        kind: "timeline",
        label: words.toreUndKarten,
        items: official === null ? [] : eventsOf(spiel, official.tore, official.karten),
        empty: { kind: "none", plural: official === null ? words.officialToreUndKarten : words.toreUndKarten },
      },
    ],
  };
}

/**
 * The match's five facts, a tile each, an absent one a dash: its matchday, a group matchday by its number over its
 * phase; its date, the day and the month over the weekday and the year, and its time; its referee where the referee's name is public; its venue.
 */
function tilesOf(spiel: FLSpielJoined, page: FLSpielPageResponse): readonly [StatTile, StatTile, StatTile, StatTile, StatTile] {
  const { fact } = COPY.spielplan;
  const group = spiel.saison_phase === "gruppenphase";
  const datum = spiel.datum === null ? null : formatDatumPair(spiel.datum as CalendarDay);
  return [
    group
      ? { label: fact.spieltag, value: { record: formatOrdinal(page.spieltag_position) }, line: PHASE_LABELS.gruppenphase }
      : { label: fact.spieltag, value: matchdayOf(spiel, page), words: true },
    datum === null
      ? { label: fact.datum, value: COPY.shared.noValue }
      : { label: fact.datum, value: { record: datum.figure }, line: { record: datum.line } },
    { label: fact.uhrzeit, value: spiel.uhrzeit === null ? COPY.shared.noValue : { record: formatUhrzeit(spiel.uhrzeit as Uhrzeit) } },
    {
      label: fact.schiedsrichter,
      value: spiel.schiedsrichter?.name == null ? COPY.shared.noValue : { record: spiel.schiedsrichter.name },
      words: true,
    },
    spiel.ort === null
      ? { label: fact.spielort, value: COPY.shared.noValue, words: true }
      : { label: fact.spielort, value: { record: spiel.ort.name }, words: true, href: buildMapsSearchUrl(spiel.ort.maps_link) },
  ];
}

/** A pupil as the public read names them: a name the consent publishes, else „anonym“; a goal nobody was named for, „unbekannt“. */
function personOf(spieler: Pick<FLSpielberichtSpielerPublic, "type" | "vorname" | "nachname">): Words {
  const words = SERVER_COPY.season.spiel;
  if (spieler.type === "unknown") return words.unbekannt;
  if (spieler.type === "anonymous" || spieler.vorname === null) return words.anonym;
  return { record: spieler.nachname === null ? spieler.vorname : `${spieler.vorname} ${spieler.nachname}` };
}

/** A line-up's pupils as one table: a row a pupil, with their number and position. */
function tableOf(label: Copy, spieler: readonly FLAufstellungEntryPublic[]): TableProps {
  const { column, spiel } = SERVER_COPY.season;
  return {
    label,
    nameLabel: column.name,
    columns: [
      { key: "nummer", label: column.nummer, figures: true },
      { key: "position", label: column.position },
    ],
    rows: spieler.map((entry, index) => ({
      id: String(index),
      name: personOf(entry),
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
function eventsOf(spiel: FLSpielJoined, tore: readonly FLSpielberichtTorPublic[], karten: readonly FLSpielberichtKartePublic[]): Checkpoint[] {
  const words = SERVER_COPY.season.spiel;
  const kuerzel = { team1: { record: spiel.team1?.shorthand ?? "" }, team2: { record: spiel.team2?.shorthand ?? "" } };
  const events = [
    ...tore.map((tor) => ({ kind: "tor" as const, minute: tor.minute, tor })),
    ...karten.map((karte) => ({ kind: "karte" as const, minute: karte.minute, karte })),
  ].sort((one, other) => earlier(one.minute, other.minute));
  const score = { team1: 0, team2: 0 };
  return events.map((event, index) => {
    if (event.kind === "karte") {
      const { karte } = event;
      return {
        id: `k${String(index)}`,
        mark: { record: karte.minute },
        title: words.event(words.karte[karte.farbe], personOf(karte.spieler)),
        detail: kuerzel[karte.seite],
      };
    }
    const { tor } = event;
    score[tor.eigentor ? (tor.seite === "team1" ? "team2" : "team1") : tor.seite] += 1;
    return {
      id: `t${String(index)}`,
      mark: { record: tor.minute },
      title: words.event(tor.eigentor ? words.eigentor : words.tor, personOf(tor.spieler)),
      detail: SERVER_COPY.season.labelled(kuerzel[tor.seite], { record: formatErgebnis(score) }),
    };
  });
}
