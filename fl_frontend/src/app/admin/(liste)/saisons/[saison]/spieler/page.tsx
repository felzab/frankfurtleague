import { cache } from "react";
import { notFound } from "next/navigation";

import { filterValue } from "@/kit/filterValue";
import { ListPage } from "@/kit/ListPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { kaderName } from "@/features/spieler/constants";
import { getSpielerAdmin } from "@/features/spieler/queries";
import { rowChip } from "@/features/spieler/rowChip";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import type { FLSpielerAdminRow } from "@/core/generated/client/types";
import type { Filter } from "@/kit/Filters";
import type { TableHead, TableRow } from "@/kit/Table";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/admin/saisons/[saison]/spieler">;

const WORDS = COPY.admin.spieler;

/** The season's squad rows, `null` for a season the league does not hold: one read for the tab's title and the page alike. */
const read = cache(getSpielerAdmin);

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const { saison } = await params;
  return metadataFor(read(saison), () => pageMetadata(parent, ROUTES.adminSpieler, ROUTES.adminSpieler.path(saison)));
}

/** What the state filter offers, each by whether a row answers it. */
const STATES = {
  inKader: { label: WORDS.inKader, holds: (row: FLSpielerAdminRow) => row.inactive_since === null },
  nominee: { label: WORDS.nominee, holds: (row: FLSpielerAdminRow) => row.inactive_since === null && row.is_nachnominiert },
  deregistered: { label: WORDS.deregistered, holds: (row: FLSpielerAdminRow) => row.inactive_since !== null },
};

type State = keyof typeof STATES;

const STATE_OPTIONS = (Object.keys(STATES) as State[]).map((id) => ({ id, label: STATES[id].label }));

/** One squad row, opening the player's editor in this season: the name with its chip, the club, the shirt and the Stufe. */
function rowOf(saison: string, row: FLSpielerAdminRow): TableRow {
  const chip = rowChip(row);
  return {
    id: row.spieler_id,
    name: { record: kaderName(row) },
    href: ROUTES.adminSpielerRecord.path(saison, row.spieler_id),
    ...(chip === undefined ? {} : { chip }),
    muted: row.inactive_since !== null,
    cells: {
      team: row.team_name === null ? COPY.shared.noValue : { record: row.team_name },
      nummer: row.nummer === null ? COPY.shared.noValue : { record: row.nummer },
      stufe: row.stufe === null ? COPY.shared.noValue : COPY.admin.saison.stufe[row.stufe],
    },
  };
}

/** The clubs the season's rows name, by name, and the filters over them with the address's values. */
function filtersOf(rows: readonly FLSpielerAdminRow[], team: string | string[] | undefined, state: State | null): readonly [Filter, Filter] {
  const teams = new Map(rows.flatMap((row) => (row.team_name === null ? [] : [[row.team_id, row.team_name] as const])));
  const options = [...teams]
    .sort(([, one], [, other]) => one.localeCompare(other, "de"))
    .map(([id, name]) => ({ id, label: { record: name } }));
  return [
    {
      name: "team",
      label: COPY.account.entries.facts.team,
      all: SERVER_COPY.season.filter.all,
      options,
      value: filterValue(team, options),
    },
    {
      name: "state",
      label: COPY.admin.schiedsrichter.state,
      all: SERVER_COPY.season.filter.all,
      options: STATE_OPTIONS,
      value: state,
    },
  ];
}

async function readSeason(params: Props["params"], searchParams: Props["searchParams"]) {
  const { saison } = await params;
  const answer = await read(saison);
  if (answer === null) notFound();
  const named = await searchParams;
  const stateId = filterValue(named.state, STATE_OPTIONS);
  const [team, state] = filtersOf(answer.spieler, named.team, stateId);
  const chosen = stateId === null ? null : STATES[stateId];
  const shown = answer.spieler.filter((row) => (team.value === null || row.team_id === team.value) && (chosen === null || chosen.holds(row)));
  return { saison, filters: [team, state] as const, shown };
}

/** The table's head, drawn while the rows are read and over them once they are. */
const HEAD: TableHead = {
  nameLabel: COPY.shared.name,
  columns: [
    { key: "team", label: COPY.account.entries.facts.team, hideOnPhone: true, width: "phone" },
    { key: "nummer", label: SERVER_COPY.season.column.nummer, figures: true, narrow: true, width: "count" },
    { key: "stufe", label: WORDS.stufe, hideOnPhone: true },
  ],
};

/**
 * The season's squad rows, every team's, live and ausgetragen alike: narrowed by club and state, the values in the
 * address, and by the text typed into the search field. No create: every player enters through their team's
 * registration link.
 */
export default function SpielerPage({ params, searchParams }: Props) {
  const season = readSeason(params, searchParams);
  return (
    <ListPage
      head={{ scope: "area", title: { route: "adminSpieler" } }}
      filters={season.then(({ filters }) => filters)}
      list={{
        kind: "table",
        search: { label: WORDS.search },
        head: HEAD,
        content: season.then(({ saison, filters, shown }) => ({
          table: {
            label: ROUTES.adminSpieler.title,
            rows: shown.map((row) => rowOf(saison, row)),
            empty: {
              kind: filters.every((filter) => filter.value === null) ? "none" : "filter",
              plural: ROUTES.adminSpieler.title,
              glyph: "spieler",
            } as const,
          },
        })),
      }}
    />
  );
}
