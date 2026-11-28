import { notFound } from "next/navigation";

import { COPY } from "@/core/copy/shared";
import { dayOf, formatErgebnis, formatNumber, formatOrdinal } from "@/core/format";
import { buildMapsSearchUrl } from "@/core/maps";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getTeamPage } from "@/features/saisons/queries";
import { publicSaisonOf } from "@/features/saisons/resolvers";
import { headedMatchOf, outcomeFor } from "@/features/spiele/blocks";
import { publicPupilHead, publicPupilRow } from "@/features/spieler/constants";
import { austrittChip, austrittState } from "@/features/teams/constants";
import { ReadFolds } from "@/kit/ReadFolds";
import { ReadPage } from "@/kit/ReadPage";
import { TeamProfileHead } from "@/kit/TeamProfileHead";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";
import { objectIdParamOf } from "@/shared/utils/routeParams";

import type { FLTeamPageResponse } from "@/core/generated/client/types";
import type { ReadRecord } from "@/kit/ReadPage";
import type { StatTile } from "@/kit/StatTiles";
import type { Metadata } from "next";

type Props = PageProps<"/saisons/[saison]/teams/[team]">;

/** The club the address names, or `null` for a malformed id, a season the public may not read, or no such club in it. */
async function findPage(params: Props["params"]): Promise<FLTeamPageResponse | null> {
  const team = await objectIdParamOf(params, "team");
  const saison = await publicSaisonOf(params);
  return team === null || saison === null ? null : getTeamPage(saison, team);
}

async function readPage(params: Props["params"]): Promise<FLTeamPageResponse> {
  const page = await findPage(params);
  if (page === null) notFound();
  return page;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { saison } = await params;
  return metadataFor(findPage(params), ({ team }) =>
    pageMetadata(ROUTES.team, ROUTES.team.path(saison, team.id), {
      title: { record: team.name },
      description: SERVER_COPY.description.team(team.name, saison),
    }),
  );
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

/** The club's standing at a glance: its place in its group, its points, its matches played and its goals. */
function tilesOf({ team, standing }: FLTeamPageResponse): readonly [StatTile, StatTile, StatTile, StatTile] {
  const words = SERVER_COPY.season.team;
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
      value: { record: formatNumber(statistik.count_played_spiele) },
      line: { counts: [statistik.siege, statistik.unentschieden, statistik.niederlagen] },
    },
    {
      label: words.tore,
      value: { record: formatErgebnis({ team1: statistik.tore_scored, team2: statistik.tore_conceded }) },
      line: words.differenz(statistik.tore_scored - statistik.tore_conceded),
    },
  ];
}

async function readRecord(params: Props["params"]): Promise<ReadRecord> {
  const page = await readPage(params);
  const { team, spiele, kader } = page;
  const { column } = SERVER_COPY.season;
  const { addressLine, streetWithHouseNumber } = COPY.shared.address;
  const address = addressLine(streetWithHouseNumber(team.address.street, team.address.house_number), team.address.postcode, team.address.city);
  return {
    title: { record: team.name },
    ...(team.austritt === null ? {} : { chip: austrittChip(team.austritt.type) }),
    team: {
      head: (
        <TeamProfileHead
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
              title: COPY.shared.austrittSince(austrittState(team.austritt.type), dayOf(team.austritt.date)),
              text: { record: team.austritt.reason },
            },
    },
    groups: [
      { kind: "tiles", tiles: { layout: "four", items: tilesOf(page) } },
      {
        title: COPY.page.spiele,
        kind: "timeline",
        label: COPY.page.spiele,
        items: spiele.map((spiel, index) => {
          const headed = headedMatchOf(spiel);
          return {
            id: spiel.id,
            point: { record: formatNumber(index + 1) },
            counts: true,
            outcome: outcomeFor(spiel, team.id),
            title: headed.head,
            spiel: headed.spiel,
          };
        }),
        empty: { kind: "none", plural: COPY.page.spiele, glyph: "spielplan" },
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
                    ...publicPupilHead(column),
                    rows: kader.map((spieler, index) => ({ id: String(index), ...publicPupilRow(spieler) })),
                    empty: { kind: "none", plural: COPY.page.teamKader, one: true, glyph: "teams" },
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
