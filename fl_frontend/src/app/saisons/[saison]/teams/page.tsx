import { notFound } from "next/navigation";

import { ListPage } from "@/kit/ListPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getSaisonTeams } from "@/features/saisons/queries";
import { resolvePublicSaisonParam } from "@/features/saisons/resolvers";
import { austrittChip } from "@/features/teams/constants";
import { pageMetadata } from "@/shared/utils/metadata";

import type { Filter } from "@/kit/Filters";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/saisons/[saison]/teams">;

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const saison = await resolvePublicSaisonParam(params);
  return pageMetadata(parent, ROUTES.teams, ROUTES.teams.path(saison), { description: SERVER_COPY.description.teams(saison) });
}

/** The season's clubs by name, and the group filter over them with the address's value. */
async function readSeason(params: Props["params"], searchParams: Props["searchParams"]) {
  const saison = await resolvePublicSaisonParam(params);
  const read = await getSaisonTeams(saison);
  if (read === null) notFound();
  const named = (await searchParams).gruppe;
  const value = Array.isArray(named) ? named[0] : named;
  const groups = [...new Set(read.teams.map((team) => team.gruppe))].sort();
  const words = SERVER_COPY.season.filter;
  const filter: Filter = {
    name: "gruppe",
    label: words.gruppe,
    all: words.all,
    options: groups.map((gruppe) => ({ id: gruppe, label: SERVER_COPY.season.gruppe(gruppe) })),
    value: groups.find((gruppe) => gruppe === value) ?? null,
  };
  const teams = [...read.teams].sort((one, other) => one.name.localeCompare(other.name, "de"));
  return { saison, teams, filter };
}

/**
 * Teams: the season's clubs in one alphabetical list of tiles, each naming its group under its name and opening
 * the club's page, narrowed by group, the value in the address, and by the text typed into its search field, which
 * stays on the page, as the Spielsuche narrows its matches.
 */
export default function TeamsPage({ params, searchParams }: Props) {
  const season = readSeason(params, searchParams);
  return (
    <ListPage
      head={{ scope: "saison", title: { route: "teams" } }}
      filters={season.then(({ filter }) => [filter])}
      list={{
        kind: "tiles",
        search: { label: COPY.page.teams },
        content: season.then(({ saison, teams, filter }) => ({
          tiles: teams
            .filter((team) => filter.value === null || team.gruppe === filter.value)
            .map((team) => ({
              tile: {
                name: { record: team.name },
                plaque: { record: team.shorthand },
                href: ROUTES.team.path(saison, team.id),
                line: SERVER_COPY.season.gruppe(team.gruppe),
                muted: team.austritt_type !== null,
                ...(team.austritt_type === null ? {} : { chip: austrittChip(team.austritt_type) }),
              },
              words: `${team.name} ${team.shorthand}`,
            })),
          empty: { kind: filter.value === null ? "none" : "filter", plural: COPY.page.teams, glyph: "teams" },
        })),
      }}
    />
  );
}
