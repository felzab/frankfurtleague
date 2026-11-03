import { notFound } from "next/navigation";

import { ClubHead } from "@/kit/ClubHead";
import { ReadFolds } from "@/kit/ReadFolds";
import { ReadPage } from "@/kit/ReadPage";
import { NONE, SpielList } from "@/kit/SpielRow";

import { COPY } from "@/core/copy";
import { formatErgebnis, formatNumber } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getTeamPage } from "@/features/saisons/queries";
import { resolvePublicSaisonParam } from "@/features/saisons/resolvers";
import { matchdayOf, matchRowOf } from "@/features/spiele/blocks";
import { austrittKuerzel, austrittZustand } from "@/features/teams/constants";
import { buildMapsSearchUrl } from "@/shared/utils/format";
import { pageMetadata } from "@/shared/utils/metadata";
import { resolveObjectIdParam } from "@/shared/utils/routeParams";

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
    title: ROUTES.team.title(team.name),
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
const personOf = (spieler: FLSpielerPublic) =>
  spieler.vorname === null ? SERVER_COPY.season.spiel.anonym : [spieler.vorname, spieler.nachname].filter((name) => name !== null).join(" ");

/** A goal difference, signed where it is not level. */
const signed = (difference: number) => (difference > 0 ? `+${formatNumber(difference)}` : formatNumber(difference));

/** The club's standing at a glance: its place in its group, its points, its matches played and its goals. */
function tilesOf({ team, standing }: FLTeamPageResponse): readonly [StatTile, StatTile, StatTile, StatTile] {
  const words = SERVER_COPY.season.club;
  const group = SERVER_COPY.season.gruppe(team.gruppe);
  if (standing === null)
    return [
      { label: words.platz, value: NONE, line: group },
      { label: words.punkte, value: NONE },
      { label: words.spiele, value: NONE },
      { label: words.tore, value: NONE },
    ];
  const { statistik } = standing;
  return [
    { label: words.platz, value: standing.platz === null ? NONE : `${formatNumber(standing.platz)}.`, line: group },
    { label: words.punkte, value: formatNumber(statistik.punkte) },
    {
      label: words.spiele,
      value: formatNumber(statistik.count_gespielte_spiele),
      line: { record: [formatNumber(statistik.siege), formatNumber(statistik.unentschieden), formatNumber(statistik.niederlagen)] },
    },
    {
      label: words.tore,
      value: formatErgebnis({ team1: statistik.tore_geschossen, team2: statistik.tore_kassiert }),
      line: words.differenz(signed(statistik.tore_geschossen - statistik.tore_kassiert)),
    },
  ];
}

async function readRecord(params: Props["params"]): Promise<ReadRecord> {
  const page = await readPage(params);
  const { team, spiele, kader } = page;
  const { column } = SERVER_COPY.season;
  const address = `${team.address.strasse} ${team.address.hausnummer}, ${team.address.plz} ${team.address.stadt}`;
  return {
    title: { record: team.name },
    ...(team.austritt?.type === "disqualifikation"
      ? { chip: { tone: "danger", label: austrittKuerzel(team.austritt.type), spoken: austrittZustand(team.austritt.type) } }
      : {}),
    club: {
      head: (
        <ClubHead
          kuerzel={team.shorthand}
          name={team.name}
          website={team.website_url?.startsWith("https://") === true ? (team.website_url as `https://${string}`) : null}
          school={team.full_name}
          address={address}
          map={buildMapsSearchUrl(address)}
          description={team.description}
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
          mark: formatNumber(index + 1),
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
                      cells: { nummer: spieler.nummer ?? "", position: spieler.position ?? "" },
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
