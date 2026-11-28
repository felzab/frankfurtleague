import { cache } from "react";

import { boxRulesOf } from "@/core/action";
import { COPY } from "@/core/copy/shared";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { readAsSeatHolder, requireTeamSeats, teamMetadata } from "@/features/roles/resolvers";
import { getKader } from "@/features/spieler/queries";
import { ListPage } from "@/kit/ListPage";
import { pageMetadata } from "@/shared/utils/metadata";

import { saveKaderRow } from "./kaderRowActs";
import { KaderTable } from "./KaderTable";

import type { TeamSeat } from "@/features/roles/resolvers";
import type { TableHead } from "@/kit/Table";
import type { Metadata } from "next";

type Props = PageProps<"/area/team/[team]/[saison]/kader">;

const WORDS = COPY.kader;

const address = ({ team, saison }: { team: string; saison: string }) => ROUTES.teamKader.path(team, saison);

/** Keyed on the seat's two ids rather than the seat, since `cache` compares its arguments by identity. */
const kaderRead = cache(getKader);
const kaderOf = (seat: TeamSeat) => kaderRead(seat.team_id, seat.saison_id);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return teamMetadata(params, address, kaderOf, async () => pageMetadata(ROUTES.teamKader, address(await params)));
}

/**
 * The table's head: the shirt number beside the name on a phone where the box holds it, position and Stufe from 42 rem
 * of the table's box, which a phone row says in its line instead, the number too where the box leaves it out.
 */
const HEAD: TableHead = {
  nameLabel: COPY.shared.name,
  state: { label: COPY.shared.facts.state },
  columns: [
    { key: "nummer", label: SERVER_COPY.season.column.nummer, figures: true, narrow: true, onLine: "labelled", width: "count" },
    { key: "position", label: WORDS.position, hideOnPhone: true, onLine: "value", width: "word" },
    { key: "stufe", label: WORDS.stufe, hideOnPhone: true, onLine: "value", width: "code" },
  ],
};

/** The page's one read, after the seat it is drawn for, handed to its template running. */
async function read(params: Props["params"]) {
  const [seat] = await requireTeamSeats(params, address);
  const kader = await readAsSeatHolder(() => kaderOf(seat));
  return {
    drawn: (
      <KaderTable
        head={HEAD}
        read={kader}
        team={seat.team_id}
        saison={seat.saison_id}
        rules={boxRulesOf(saveKaderRow)}
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
      list={{ kind: "table", search: { label: WORDS.search }, head: HEAD, content: read(params) }}
    />
  );
}
