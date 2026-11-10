import { ListPage } from "@/kit/ListPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { readAsSeatHolder, requireTeamSeats, teamSeatsAt } from "@/features/roles/resolvers";
import { getKader } from "@/features/spieler/queries";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { KaderTable } from "./KaderTable";

import type { TableHead } from "@/kit/Table";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/area/team/[team]/[saison]/kader">;

const WORDS = COPY.admin.spieler;

/** The page's own address, which a session sent to sign in comes back to. */
const address = ({ team, saison }: { team: string; saison: string }) => ROUTES.teamKader.path(team, saison);

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  // `teamSeatsAt` answers `null` rather than throwing: a `notFound()` thrown from `generateMetadata` leaves the tab the
  // layout's title.
  return metadataFor(teamSeatsAt(params, address), async () => pageMetadata(parent, ROUTES.teamKader, address(await params)));
}

/**
 * The table's head, drawn while the squad is read and over it once it is: the shirt number beside the name on a phone
 * where the box holds it, position and Stufe from `lg`, which a phone row says in its line instead.
 */
const HEAD: TableHead = {
  nameLabel: COPY.shared.name,
  columns: [
    { key: "nummer", label: SERVER_COPY.season.column.nummer, figures: true, narrow: true, width: "count" },
    { key: "position", label: WORDS.position, hideOnPhone: true },
    { key: "stufe", label: WORDS.stufe, hideOnPhone: true },
  ],
};

/** The page's one read, after the seat it is drawn for, handed to its template running. */
async function read(params: Props["params"]) {
  const [seat] = await requireTeamSeats(params, address);
  const squad = await readAsSeatHolder(() => getKader(seat.team_id, seat.saison_id));
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
