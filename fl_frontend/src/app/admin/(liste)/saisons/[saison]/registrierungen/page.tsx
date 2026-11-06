import { cache } from "react";
import { notFound } from "next/navigation";

import { ListPage } from "@/kit/ListPage";

import { COPY } from "@/core/copy";
import { dayOf, formatDate } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getRegistrierungenAdmin } from "@/features/registrierungen/queries";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import type { FLRegistrierungAdminRow } from "@/core/generated/client/types";
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

/** A filter's value in the address, the first where it is repeated. */
const firstOf = (value: string | string[] | undefined): string | null => (Array.isArray(value) ? value[0] : value) ?? null;

/** What the state filter offers, each by the row's own verdict. */
const STATES = {
  confirmed: { label: COPY.admin.confirmed, holds: true },
  unconfirmed: { label: COPY.admin.schiedsrichter.unconfirmed, holds: false },
};

type State = keyof typeof STATES;

const isState = (value: string | null): value is State => value !== null && Object.hasOwn(STATES, value);

/**
 * One pending registration, opening its team: a registration is decided by its team, so this list is read-only, and an
 * administrator cures what holds one up on the team's page.
 */
function rowOf(saison: string, row: FLRegistrierungAdminRow): TableRow {
  return {
    id: row.id,
    name: { record: `${row.first_name} ${row.last_name}` },
    href: ROUTES.adminTeam.path(saison, row.team_id),
    chip: row.confirmed ? { tone: "success", label: COPY.admin.confirmed } : { tone: "warn", label: COPY.admin.schiedsrichter.unconfirmed },
    cells: {
      team: row.team_name === null ? COPY.shared.noValue : { record: row.team_name },
      received: { record: formatDate(dayOf(row.submitted_at)) },
    },
  };
}

/** The clubs the season's rows name, by name, and the filters over them with the address's values. */
function filtersOf(rows: readonly FLRegistrierungAdminRow[], team: string | null, state: string | null): readonly [Filter, Filter] {
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
      value: team !== null && teams.has(team) ? team : null,
    },
    {
      name: "state",
      label: COPY.admin.schiedsrichter.state,
      all: SERVER_COPY.season.filter.all,
      options: Object.entries(STATES).map(([id, { label }]) => ({ id, label })),
      value: isState(state) ? state : null,
    },
  ];
}

async function readSeason(params: Props["params"], searchParams: Props["searchParams"]) {
  const { saison } = await params;
  const answer = await read(saison);
  if (answer === null) notFound();
  const named = await searchParams;
  const [team, state] = filtersOf(answer.registrierungen, firstOf(named.team), firstOf(named.state));
  const chosen = isState(state.value) ? STATES[state.value] : null;
  const shown = answer.registrierungen.filter(
    (row) => (team.value === null || row.team_id === team.value) && (chosen === null || chosen.holds === row.confirmed),
  );
  return { saison, filters: [team, state] as const, shown };
}

/** The table's head, drawn while the rows are read and over them once they are. */
const HEAD: TableHead = {
  nameLabel: COPY.shared.name,
  columns: [
    { key: "team", label: COPY.account.entries.facts.team, narrow: true, width: "phone" },
    { key: "received", label: COPY.admin.bewerbung.received, figures: true, hideOnPhone: true, width: "date" },
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
      list={{
        kind: "table",
        search: { label: COPY.admin.registrierung.search },
        head: HEAD,
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
