import { notFound } from "next/navigation";

import { actLabel } from "@/kit/dialogAct";
import { filterValue } from "@/kit/filterValue";
import { ListPage } from "@/kit/ListPage";

import { COPY } from "@/core/copy";
import { FLGruppenNames, FLTeamListState } from "@/core/generated/client/types";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { adminTeamChip, trikotFarbeLabel } from "@/features/teams/constants";
import { TEAM_CLUB_REQUIRED, TEAM_ENTRY_RULES } from "@/features/teams/fieldRules";
import { gruppeOptions, trikotOptions } from "@/features/teams/options";
import { getTeamsAdmin } from "@/features/teams/queries";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { enterTeam } from "./enterTeam";
import { TeamEntryFields } from "./TeamEntryFields";

import type { FLTeamsAdminListResponse, FLTeamsAdminRow } from "@/core/generated/client/types";
import type { Filter } from "@/kit/Filters";
import type { ListCreate } from "@/kit/ListPage";
import type { TableHead, TableRow } from "@/kit/Table";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/admin/saisons/[saison]/teams">;

const WORDS = COPY.admin.team;
const TEAM = COPY.shared.facts.team;
const ACT = { verb: "enter", object: TEAM } as const;

/** What a read takes as a filter's options, its enum's values: the read's own answer says which of them the list offers. */
const taken = <Value extends string>(allowed: Readonly<Record<string, Value>>) => Object.values(allowed).map((id) => ({ id }));

/** What the address asks of the list, read off the values the read takes, so a hand-typed one narrows nothing. */
async function queryOf(searchParams: Props["searchParams"]) {
  const { state, gruppe } = await searchParams;
  return { state: filterValue(state, taken(FLTeamListState)), gruppe: filterValue(gruppe, taken(FLGruppenNames)) };
}

async function read({ params, searchParams }: Pick<Props, "params" | "searchParams">): Promise<FLTeamsAdminListResponse | null> {
  const [{ saison }, { state, gruppe }] = await Promise.all([params, queryOf(searchParams)]);
  return getTeamsAdmin(saison, state, gruppe);
}

async function readOrNotFound(props: Pick<Props, "params" | "searchParams">): Promise<FLTeamsAdminListResponse> {
  const found = await read(props);
  if (found === null) notFound();
  return found;
}

export async function generateMetadata({ params, searchParams }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const { saison } = await params;
  return metadataFor(read({ params, searchParams }), () => pageMetadata(parent, ROUTES.adminTeams, ROUTES.adminTeams.path(saison)));
}

/** One club's row, opening its editor in this season: its Kürzel, its name with its chip, its group and its colour. */
function rowOf(saison: string, team: FLTeamsAdminRow): TableRow {
  const chip = adminTeamChip(team.inactive_since, team.austritt_type);
  return {
    id: team.id,
    name: { record: team.name },
    plaque: { record: team.shorthand },
    href: ROUTES.adminTeam.path(saison, team.id),
    ...(chip === undefined ? {} : { chip, muted: true }),
    cells: {
      gruppe: team.gruppe === null ? COPY.shared.noValue : COPY.shared.season.gruppe(team.gruppe),
      trikotFarbe: team.trikot_farbe === null ? COPY.shared.noValue : trikotFarbeLabel(team.trikot_farbe),
    },
  };
}

/** The table's head, drawn while the rows are read and over them once they are. */
const HEAD: TableHead = {
  nameLabel: TEAM,
  state: { label: COPY.admin.schiedsrichter.state },
  columns: [
    { key: "gruppe", label: COPY.team.gruppe, narrow: true },
    { key: "trikotFarbe", label: COPY.team.trikotFarbe, hideOnPhone: true },
  ],
};

/**
 * A season's Teams: its clubs, searched on the page and narrowed by group and by state, the state „Stillgelegt“ the one
 * way to a retired club, which reads past the season's rows; a club entered from the dialog over the list while the
 * season is planned, one the league knows or a new one.
 */
export default function AdminTeamsPage({ params, searchParams }: Props) {
  const list = readOrNotFound({ params, searchParams });
  return (
    <ListPage
      head={{ scope: "area", title: { route: "adminTeams" } }}
      filters={readFilters(list, searchParams)}
      filterCount={2}
      create={{ label: actLabel(ACT), act: readCreate(list, params) }}
      list={{
        kind: "table",
        search: { label: WORDS.search },
        head: HEAD,
        wait: 24,
        plaques: true,
        content: readTeams(list, params, searchParams),
      }}
    />
  );
}

async function readFilters(list: Promise<FLTeamsAdminListResponse>, searchParams: Props["searchParams"]): Promise<Filter[]> {
  const [{ entry }, { state, gruppe }] = await Promise.all([list, queryOf(searchParams)]);
  return [
    {
      name: "gruppe",
      label: COPY.team.gruppe,
      all: SERVER_COPY.season.filter.all,
      options: entry.gruppen.map((offer) => ({ id: offer.gruppe, label: COPY.shared.season.gruppe(offer.gruppe) })),
      value: gruppe,
    },
    {
      name: "state",
      label: COPY.admin.schiedsrichter.state,
      all: SERVER_COPY.season.filter.all,
      options: [
        { id: FLTeamListState.active, label: WORDS.active },
        { id: FLTeamListState.departed, label: COPY.admin.spiel.departed },
        { id: FLTeamListState.retired, label: COPY.shared.retired },
      ],
      value: state,
    },
  ];
}

/** The entry's act, closed while the read says the season takes none. */
async function readCreate(list: Promise<FLTeamsAdminListResponse>, params: Props["params"]): Promise<ListCreate> {
  const [{ entry }, { saison }] = await Promise.all([list, params]);
  return {
    title: COPY.shared.withObject(TEAM, ACT.verb),
    act: ACT,
    action: enterTeam,
    carry: { saison_id: saison },
    children: (
      <TeamEntryFields
        saison={saison}
        clubs={entry.clubs.map((club) => ({ id: club.id, label: { record: club.name } }))}
        gruppen={gruppeOptions(entry.gruppen, null)}
        colours={trikotOptions(entry.taken)}
        rules={TEAM_ENTRY_RULES}
        clubRequired={TEAM_CLUB_REQUIRED}
      />
    ),
    ...(entry.closed ? { locked: WORDS.onlyPlanned } : {}),
  };
}

async function readTeams(list: Promise<FLTeamsAdminListResponse>, params: Props["params"], searchParams: Props["searchParams"]) {
  const [{ teams }, { saison }, { state, gruppe }] = await Promise.all([list, params, queryOf(searchParams)]);
  const plural = ROUTES.adminTeams.title;
  return {
    table: {
      label: plural,
      rows: teams.map((team) => rowOf(saison, team)),
      empty: state === null && gruppe === null ? ({ kind: "none", plural, glyph: "teams" } as const) : ({ kind: "filter", plural } as const),
    },
  };
}
