import { cache } from "react";
import { notFound } from "next/navigation";

import { filterValue } from "@/kit/filterValue";
import { ListPage } from "@/kit/ListPage";

import { COPY } from "@/core/copy";
import { dayOf, formatDate } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { NOT_SENT } from "@/features/bewerbungen/seats";
import { getRegistrierungenAdmin } from "@/features/registrierungen/queries";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import type { FLRegistrierungAdminRow } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";
import type { Filter } from "@/kit/Filters";
import type { TableHead, TableRow } from "@/kit/Table";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/admin/saisons/[saison]/registrierungen">;

/** The season's pending registrations, `null` for a season the league does not hold: one read for the tab's title and the page alike. */
const read = cache(getRegistrierungenAdmin);

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const { saison } = await params;
  return metadataFor(read(saison), () => pageMetadata(parent, ROUTES.adminRegistrierungen, ROUTES.adminRegistrierungen.path(saison)));
}

/** What the state filter offers, each by the row's own verdict. */
const STATES = {
  confirmed: { label: COPY.admin.confirmed, holds: true },
  unconfirmed: { label: COPY.admin.schiedsrichter.unconfirmed, holds: false },
};

type State = keyof typeof STATES;

const STATE_OPTIONS = (Object.keys(STATES) as State[]).map((id) => ({ id, label: STATES[id].label }));

/** Whether the pupil answered, and where they did not whether they were ever asked: the row lapses on its day either way. */
function chipOf(row: FLRegistrierungAdminRow): ChipProps {
  if (row.confirmed) return { tone: "success", label: COPY.admin.confirmed };
  return row.unmailed ? NOT_SENT : { tone: "warn", label: COPY.admin.schiedsrichter.unconfirmed };
}

/**
 * One pending registration, opening its team: a registration is decided by its team, so this list is read-only, and an
 * administrator cures what holds one up on the team's page.
 */
function rowOf(saison: string, row: FLRegistrierungAdminRow): TableRow {
  return {
    id: row.id,
    name: { record: `${row.first_name} ${row.last_name}` },
    href: ROUTES.adminTeam.path(saison, row.team_id),
    chip: chipOf(row),
    cells: {
      team: row.team_name === null ? COPY.shared.noValue : { record: row.team_name },
      received: { record: formatDate(dayOf(row.submitted_at)) },
    },
  };
}

/** The clubs the season's rows name, by name, and the filters over them with the address's values. */
function filtersOf(
  rows: readonly FLRegistrierungAdminRow[],
  team: string | string[] | undefined,
  state: State | null,
): readonly [Filter, Filter] {
  const teams = new Map(rows.flatMap((row) => (row.team_name === null ? [] : [[row.team_id, row.team_name] as const])));
  const options = [...teams]
    .sort(([, one], [, other]) => one.localeCompare(other, "de"))
    .map(([id, name]) => ({ id, label: { record: name } }));
  return [
    {
      name: "team",
      label: COPY.shared.facts.team,
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
  const [team, state] = filtersOf(answer.registrierungen, named.team, stateId);
  const chosen = stateId === null ? null : STATES[stateId];
  const shown = answer.registrierungen.filter(
    (row) => (team.value === null || row.team_id === team.value) && (chosen === null || chosen.holds === row.confirmed),
  );
  return { saison, filters: [team, state] as const, shown, cut: answer.complete ? null : COPY.admin.registrierung.cut };
}

/** The table's head, drawn while the rows are read and over them once they are. */
const HEAD: TableHead = {
  nameLabel: COPY.shared.name,
  columns: [
    { key: "team", label: COPY.shared.facts.team, narrow: true, width: "phone", cut: true },
    { key: "received", label: COPY.admin.bewerbung.received, hideOnPhone: true, width: "date" },
  ],
};

/**
 * The season's pending registrations, newest first, each leading to its team: narrowed by club and by whether the
 * pupil answered their link, the values in the address, and by the text typed into the search field.
 */
export default function RegistrierungenPage({ params, searchParams }: Props) {
  const season = readSeason(params, searchParams);
  return (
    <ListPage
      head={{ scope: "area", title: { route: "adminRegistrierungen" } }}
      filters={season.then(({ filters }) => filters)}
      filterCount={2}
      notice={season.then(({ cut }) => cut)}
      list={{
        kind: "table",
        search: { label: COPY.admin.registrierung.search },
        head: HEAD,
        wait: 30,
        content: season.then(({ saison, filters, shown }) => ({
          table: {
            label: ROUTES.adminRegistrierungen.title,
            rows: shown.map((row) => rowOf(saison, row)),
            empty: {
              kind: filters.every((filter) => filter.value === null) ? "none" : "filter",
              plural: ROUTES.adminRegistrierungen.title,
              glyph: "registrierungen",
            } as const,
          },
        })),
      }}
    />
  );
}
