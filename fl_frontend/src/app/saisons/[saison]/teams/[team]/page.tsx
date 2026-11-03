import { notFound } from "next/navigation";

import { ClubHead } from "@/kit/ClubHead";
import { ReadFolds } from "@/kit/ReadFolds";
import { ReadPage } from "@/kit/ReadPage";
import { SpielList } from "@/kit/SpielRow";

import { COPY } from "@/core/copy";
import { formatErgebnis, formatNumber, formatOrdinal } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getTeamPage } from "@/features/saisons/queries";
import { resolvePublicSaisonParam } from "@/features/saisons/resolvers";
import { matchdayOf, matchRowOf, outcomeFor } from "@/features/spiele/blocks";
import { austrittChip, austrittZustand } from "@/features/teams/constants";
import { buildMapsSearchUrl } from "@/shared/utils/format";
import { pageMetadata } from "@/shared/utils/metadata";
import { resolveObjectIdParam } from "@/shared/utils/routeParams";

import type { Words } from "@/core/copy";
import type { CalendarDay } from "@/core/format";
import type { FLSpielerPublic, FLTeamPageResponse } from "@/core/generated/client/types";
import type { ReadRecord } from "@/kit/ReadPage";
import type { StatTile } from "@/kit/StatTiles";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/saisons/[saison]/teams/[team]">;

async function readPage(params: Props["params"]): Promise<FLTeamPageResponse> {
  const team = await resolveObjectIdParam(params, "team");
  const page = await getTeamPage(await resolvePublicSaisonParam(params), team);
  if (page === null) notFound();
  return page;
}

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const { saison } = await params;
  const { team } = await readPage(params);
  return pageMetadata(parent, ROUTES.team, ROUTES.team.path(saison, team.id), {
    title: { record: team.name },
    description: SERVER_COPY.description.team(team.name, saison),
  });
}

/**
 * A club's page in one season: its head, with its exit from the season under it where it left, its standing as four
 * tiles, its matches along the dotted line by matchday, and its squad folded behind its card's head.
 */
export default function TeamPage({ params }: Props) {
  return (
    <ReadPage
      scope="saison"
      record={readRecord(params)}
    />
  );
}

/** A pupil of the squad as the public read names them: a name the consent publishes, else „anonym“. */
const personOf = (spieler: FLSpielerPublic): Words =>
  spieler.vorname === null
    ? SERVER_COPY.season.spiel.anonym
    : { record: [spieler.vorname, spieler.nachname].filter((name) => name !== null).join(" ") };

/** A pupil's number and position, each left out while the record holds none. */
const cellsOf = ({ nummer, position }: Pick<FLSpielerPublic, "nummer" | "position">) => ({
  ...(nummer === null ? {} : { nummer: { record: nummer } }),
  ...(position === null ? {} : { position: { record: position } }),
});

/** The club's standing at a glance: its place in its group, its points, its matches played and its goals. */
function tilesOf({ team, standing }: FLTeamPageResponse): readonly [StatTile, StatTile, StatTile, StatTile] {
  const words = SERVER_COPY.season.club;
  const group = SERVER_COPY.season.gruppe(team.gruppe);
  if (standing === null)
    return [
      { label: words.platz, value: COPY.shared.noValue, line: group },
      { label: words.punkte, value: COPY.shared.noValue },
      { label: words.spiele, value: COPY.shared.noValue },
      { label: words.tore, value: COPY.shared.noValue },
    ];
  const { statistik } = standing;
  return [
    { label: words.platz, value: standing.platz === null ? COPY.shared.noValue : { record: formatOrdinal(standing.platz) }, line: group },
    { label: words.punkte, value: { record: formatNumber(statistik.punkte) } },
    {
      label: words.spiele,
      value: { record: formatNumber(statistik.count_gespielte_spiele) },
      line: { counts: [statistik.siege, statistik.unentschieden, statistik.niederlagen] },
    },
    {
      label: words.tore,
      value: { record: formatErgebnis({ team1: statistik.tore_geschossen, team2: statistik.tore_kassiert }) },
      line: words.differenz(statistik.tore_geschossen - statistik.tore_kassiert),
    },
  ];
}

async function readRecord(params: Props["params"]): Promise<ReadRecord> {
  const page = await readPage(params);
  const { team, spiele, kader } = page;
  const { column } = SERVER_COPY.season;
  const { spielort } = COPY.verwaltung;
  const address = spielort.addressLine(
    spielort.strasseWithHausnummer(team.address.strasse, team.address.hausnummer),
    team.address.plz,
    team.address.stadt,
  );
  return {
    title: { record: team.name },
    ...(team.austritt === null ? {} : { chip: austrittChip(team.austritt.type) }),
    club: {
      head: (
        <ClubHead
          plaque={{ record: team.shorthand }}
          name={{ record: team.name }}
          website={team.website_url?.startsWith("https://") === true ? (team.website_url as `https://${string}`) : null}
          school={{ record: team.full_name }}
          address={address}
          map={buildMapsSearchUrl(address)}
          description={{ record: team.description }}
        />
      ),
      austritt:
        team.austritt === null
          ? null
          : {
              title: COPY.shared.austrittSeit(austrittZustand(team.austritt.type), team.austritt.datum as CalendarDay),
              text: { record: team.austritt.grund },
            },
    },
    groups: [
      { kind: "tiles", tiles: { layout: "four", items: tilesOf(page) } },
      {
        title: COPY.page.spiele,
        kind: "timeline",
        label: COPY.page.spiele,
        items: spiele.map((spiel, index) => ({
          id: spiel.id,
          mark: { record: formatNumber(index + 1) },
          outcome: outcomeFor(spiel, team.id),
          title: matchdayOf(spiel, spiel.spieltag_position),
          children: <SpielList matches={[matchRowOf(spiel)]} />,
        })),
        empty: { kind: "none", plural: COPY.page.spiele },
      },
      {
        kind: "folds",
        folds: (
          <ReadFolds
            cards={[
              {
                title: COPY.page.teamKader,
                count: kader.length,
                tables: [
                  {
                    label: COPY.page.teamKader,
                    nameLabel: column.name,
                    columns: [
                      { key: "nummer", label: column.nummer, figures: true },
                      { key: "position", label: column.position },
                    ],
                    rows: kader.map((spieler, index) => ({
                      id: String(index),
                      name: personOf(spieler),
                      cells: cellsOf(spieler),
                    })),
                    empty: { kind: "none", plural: COPY.page.teamKader },
                  },
                ],
              },
            ]}
          />
        ),
      },
    ],
  };
}
