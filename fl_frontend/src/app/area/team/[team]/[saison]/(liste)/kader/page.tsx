import { cache } from "react";

import { ListPage } from "@/kit/ListPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { readAsSeatHolder, requireTeamSeats, teamMetadata } from "@/features/roles/resolvers";
import { getKader } from "@/features/spieler/queries";
import { pageMetadata } from "@/shared/utils/metadata";

import { KaderTable } from "./KaderTable";

import type { TeamSeat } from "@/features/roles/resolvers";
import type { TableHead } from "@/kit/Table";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/area/team/[team]/[saison]/kader">;

const WORDS = COPY.admin.spieler;

/** The page's own address, which a session sent to sign in comes back to. */
const address = ({ team, saison }: { team: string; saison: string }) => ROUTES.teamKader.path(team, saison);

/** The page's one read, memoised for the render on its two ids, which `cache` compares by identity, so the tab's title and the page share it. */
const kaderRead = cache(getKader);
const kaderOf = (seat: TeamSeat) => kaderRead(seat.team_id, seat.saison_id);

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  return teamMetadata(params, address, kaderOf, async () => pageMetadata(parent, ROUTES.teamKader, address(await params)));
}

/**
 * The table's head, drawn while the squad is read and over it once it is: the shirt number beside the name on a phone
 * where the box holds it, position and Stufe from `lg`, which a phone row says in its line instead.
 */
const HEAD: TableHead = {
  nameLabel: COPY.shared.name,
  state: { label: COPY.admin.schiedsrichter.state },
  columns: [
    { key: "nummer", label: SERVER_COPY.season.column.nummer, figures: true, narrow: true, width: "count" },
    { key: "position", label: WORDS.position, hideOnPhone: true },
    { key: "stufe", label: WORDS.stufe, hideOnPhone: true },
  ],
};

/** The page's one read, after the seat it is drawn for, handed to its template running. */
async function read(params: Props["params"]) {
  const [seat] = await requireTeamSeats(params, address);
  const squad = await readAsSeatHolder(() => kaderOf(seat));
  return {
    drawn: (
      <KaderTable
        head={HEAD}
        read={squad}
        team={seat.team_id}
        saison={seat.saison_id}
      />
    ),
  };
}

/**
 * The team's squad, every seat alike: live and ausgetragen rows in shirt-number order, searched by name, a live row
 * opening its dialog. No create: every player enters through the team's registration link.
 */
export default function KaderPage({ params }: Props) {
  return (
    <ListPage
      head={{ scope: "area", title: { route: "teamKader" } }}
      list={{
        kind: "table",
        search: { label: WORDS.search },
        head: HEAD,
        // A squad of about twenty, as the board's wait drew it.
        wait: 20,
        content: read(params),
      }}
    />
  );
}
