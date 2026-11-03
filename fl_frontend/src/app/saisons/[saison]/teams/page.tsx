import { notFound } from "next/navigation";

import { ListPage } from "@/kit/ListPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getSaisonTeams } from "@/features/saisons/queries";
import { resolvePublicSaisonParam } from "@/features/saisons/resolvers";
import { austrittChip } from "@/features/teams/constants";
import { pageMetadata } from "@/shared/utils/metadata";

import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/saisons/[saison]/teams">;

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const saison = await resolvePublicSaisonParam(params);
  return pageMetadata(parent, ROUTES.teams, ROUTES.teams.path(saison), { description: SERVER_COPY.description.teams(saison) });
}

/** Teams: the season's clubs by name in one table, each row opening the club's page, its group beside it. */
export default function TeamsPage({ params }: Props) {
  return (
    <ListPage
      head={{ scope: "saison", title: { route: "teams" } }}
      list={{ kind: "table", content: readTable(params) }}
    />
  );
}

async function readTable(params: Props["params"]) {
  const saison = await resolvePublicSaisonParam(params);
  const read = await getSaisonTeams(saison);
  if (read === null) notFound();
  const { column } = SERVER_COPY.season;
  return {
    table: {
      label: COPY.page.teams,
      nameLabel: column.team,
      columns: [{ key: "gruppe", label: column.gruppe }],
      rows: read.teams.map((team) => ({
        id: team.id,
        name: team.name,
        href: ROUTES.team.path(saison, team.id),
        plaque: { kuerzel: team.shorthand },
        muted: team.austritt_type !== null,
        ...(team.austritt_type === null ? {} : { chip: austrittChip(team.austritt_type) }),
        cells: { gruppe: SERVER_COPY.season.gruppe(team.gruppe) },
      })),
      empty: { kind: "none" as const, plural: COPY.page.teams, glyph: "teams" as const },
    },
  };
}
